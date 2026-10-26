import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import * as XLSX from 'xlsx';
import { eq, and } from 'drizzle-orm';
import { dbOwner, withSchoolContext } from '../../db/client.js';
import { classSection, studentImportBatch } from '../../db/schema.js';
import { StudentService } from './student.service.js';
import { GuardianService } from './guardian.service.js';
import { EnrollmentService } from './enrollment.service.js';
import { uuidv7 } from 'uuidv7';

export interface PreviewRow {
  line: number;
  lastName: string;
  postName: string;
  firstName: string;
  sex: string;
  birthDate: string;
  birthPlace: string;
  guardianPhone: string;
  guardianName: string;
  className: string;
  errors: string[];
  warnings: string[];
}

export interface ImportPreview {
  rows: PreviewRow[];
  stats: { ok: number; warnings: number; errors: number };
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const PHONE_RE = /^\+\d{7,15}$/;

function normalizeDate(raw: unknown): string {
  // xlsx cellDates:true returns Date objects — add 12h to avoid UTC midnight timezone drift
  if (raw instanceof Date) {
    return new Date(raw.getTime() + 12 * 60 * 60 * 1000).toISOString().slice(0, 10);
  }
  const s = String(raw ?? '').trim();
  if (DATE_RE.test(s)) return s;
  // Try DD/MM/YYYY
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return `${m[3]}-${m[2]!.padStart(2, '0')}-${m[1]!.padStart(2, '0')}`;
  return s;
}

function normalizePhone(raw: string): string {
  const s = String(raw ?? '').trim().replace(/[\s\-().]/g, '');
  if (!s.startsWith('+')) return `+${s}`;
  return s;
}

function str(v: unknown): string {
  if (v instanceof Date) return v.toISOString();
  return String(v ?? '').trim();
}

function col(r: Record<string, unknown>, ...keys: string[]): unknown {
  for (const k of keys) {
    if (r[k] !== undefined && r[k] !== '') return r[k];
  }
  return '';
}

@Injectable()
export class ImportService {
  constructor(
    @Inject(StudentService) private readonly studentService: StudentService,
    @Inject(GuardianService) private readonly guardianService: GuardianService,
    @Inject(EnrollmentService) private readonly enrollmentService: EnrollmentService,
  ) {}

  async preview(schoolId: string, yearId: string, buffer: Buffer, fileName: string): Promise<ImportPreview> {
    const rows = this.parseExcel(buffer);
    const sections = await dbOwner
      .select({ id: classSection.id, name: classSection.name })
      .from(classSection)
      .where(and(eq(classSection.schoolId, schoolId), eq(classSection.yearId, yearId)));
    const sectionMap = new Map(sections.map(s => [s.name.toLowerCase(), s.id]));

    return this.buildPreview(rows, sectionMap);
  }

  async commit(
    schoolId: string,
    yearId: string,
    buffer: Buffer,
    fileName: string,
  ): Promise<{ batchId: string; inserted: number; skipped: number }> {
    const rows = this.parseExcel(buffer);
    const sections = await dbOwner
      .select({ id: classSection.id, name: classSection.name })
      .from(classSection)
      .where(and(eq(classSection.schoolId, schoolId), eq(classSection.yearId, yearId)));
    const sectionMap = new Map(sections.map(s => [s.name.toLowerCase(), s.id]));
    const preview = this.buildPreview(rows, sectionMap);

    const validRows = preview.rows.filter(r => r.errors.length === 0);
    const batchId = uuidv7();

    let inserted = 0;
    await withSchoolContext(schoolId, async (tx) => {
      await tx.insert(studentImportBatch).values({
        id: batchId,
        schoolId,
        fileName,
        rowCount: validRows.length,
      });

      for (const row of validRows) {
        const code = await this.studentService.generateStudentCode();
        const dup = await this.studentService.findDuplicate(tx, schoolId, {
          lastName: row.lastName,
          postName: row.postName,
          firstName: row.firstName,
          birthDate: row.birthDate,
        });
        if (dup) continue; // skip exact duplicates silently

        const s = await this.studentService.create(tx, schoolId, {
          lastName: row.lastName,
          postName: row.postName,
          firstName: row.firstName,
          sex: (row.sex as 'M' | 'F'),
          birthDate: row.birthDate,
          birthPlace: row.birthPlace,
          importBatchId: batchId,
        }, code);

        if (row.guardianPhone) {
          await this.guardianService.createAndLink(tx, schoolId, s.id, {
            fullName: row.guardianName || `${row.lastName} ${row.firstName} (tuteur)`,
            phoneE164: row.guardianPhone,
          });
        }

        const sectionId = sectionMap.get(row.className.toLowerCase());
        if (sectionId) {
          await this.enrollmentService.create(tx, schoolId, s.id, sectionId, yearId);
        }
        inserted++;
      }
    });

    return { batchId, inserted, skipped: validRows.length - inserted };
  }

  async undo(schoolId: string, batchId: string): Promise<{ deleted: number }> {
    const [batch] = await dbOwner
      .select()
      .from(studentImportBatch)
      .where(and(eq(studentImportBatch.id, batchId), eq(studentImportBatch.schoolId, schoolId)))
      .limit(1);
    if (!batch) throw new NotFoundException('Import batch not found');

    let deleted = 0;
    await withSchoolContext(schoolId, async (tx) => {
      deleted = await this.studentService.deleteByBatchId(tx, schoolId, batchId);
      await tx.delete(studentImportBatch).where(eq(studentImportBatch.id, batchId));
    });
    return { deleted };
  }

  private parseExcel(buffer: Buffer): Record<string, unknown>[] {
    const wb = XLSX.read(buffer, { type: 'buffer', cellDates: true });
    const ws = wb.Sheets[wb.SheetNames[0]!]!;
    return XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: '' });
  }

  private buildPreview(
    rows: Record<string, unknown>[],
    sectionMap: Map<string, string>,
  ): ImportPreview {
    const preview: PreviewRow[] = [];
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i]!;
      const errors: string[] = [];
      const warnings: string[] = [];

      const lastName = str(col(r, 'Nom', 'nom', 'NOM'));
      const postName = str(col(r, 'Post-nom', 'post_nom', 'POSTNOM', 'Postnom'));
      const firstName = str(col(r, 'Prénom', 'prenom', 'PRENOM', 'Prenom'));
      const rawSex = str(col(r, 'Sexe', 'sexe', 'SEX')).toUpperCase();
      const sex = rawSex === 'M' || rawSex === 'GARÇON' || rawSex === 'GARCON' ? 'M'
                : rawSex === 'F' || rawSex === 'FILLE' ? 'F' : rawSex;
      const rawDate = col(r, 'Date de naissance', 'date_naissance', 'DateNaissance');
      const birthDate = normalizeDate(rawDate);
      const birthPlace = str(col(r, 'Lieu de naissance', 'lieu_naissance', 'LieuNaissance'));
      const rawPhone = str(col(r,
        'Téléphone du parent', 'Telephone du parent',
        'Téléphone tuteur', 'telephone_tuteur',
        'Phone', 'phone',
      ));
      const guardianPhone = rawPhone ? normalizePhone(rawPhone) : '';
      const guardianName = str(col(r, 'Nom du parent', 'Nom tuteur', 'nom_parent', 'nom_tuteur'));
      const className = str(col(r, 'Classe', 'classe', 'CLASS'));

      if (!lastName) errors.push('Nom manquant');
      if (!postName) errors.push('Post-nom manquant');
      if (!firstName) errors.push('Prénom manquant');
      if (sex !== 'M' && sex !== 'F') errors.push(`Sexe invalide "${rawSex}"`);
      if (!DATE_RE.test(birthDate)) errors.push(`Date invalide (attendu AAAA-MM-JJ ou JJ/MM/AAAA)`);
      if (!birthPlace) warnings.push('Lieu de naissance non renseigné');
      if (guardianPhone && !PHONE_RE.test(guardianPhone)) {
        warnings.push(`Téléphone "${guardianPhone}" invalide (ignoré)`);
      }
      if (!className) errors.push('Classe manquante');
      else if (!sectionMap.has(className.toLowerCase())) {
        errors.push(`Classe "${className}" introuvable`);
      }

      preview.push({ line: i + 2, lastName, postName, firstName, sex, birthDate, birthPlace, guardianPhone, guardianName, className, errors, warnings });
    }

    const stats = {
      ok: preview.filter(r => r.errors.length === 0 && r.warnings.length === 0).length,
      warnings: preview.filter(r => r.errors.length === 0 && r.warnings.length > 0).length,
      errors: preview.filter(r => r.errors.length > 0).length,
    };
    return { rows: preview, stats };
  }
}
