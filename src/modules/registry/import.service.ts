import { Injectable, NotFoundException } from '@nestjs/common';
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

function normalizeDate(raw: string): string {
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
  return String(v ?? '').trim();
}

@Injectable()
export class ImportService {
  constructor(
    private readonly studentService: StudentService,
    private readonly guardianService: GuardianService,
    private readonly enrollmentService: EnrollmentService,
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
            fullName: `${row.lastName} ${row.firstName} (tuteur)`,
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

  private parseExcel(buffer: Buffer): Record<string, string>[] {
    const wb = XLSX.read(buffer, { type: 'buffer', cellDates: true });
    const ws = wb.Sheets[wb.SheetNames[0]!]!;
    const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: '' });
    return raw.map(r => {
      const row: Record<string, string> = {};
      for (const [k, v] of Object.entries(r)) {
        row[k] = str(v);
      }
      return row;
    });
  }

  private buildPreview(
    rows: Record<string, string>[],
    sectionMap: Map<string, string>,
  ): ImportPreview {
    const preview: PreviewRow[] = [];
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i]!;
      const errors: string[] = [];
      const warnings: string[] = [];

      const lastName = str(r['Nom'] ?? r['nom'] ?? r['NOM'] ?? '');
      const postName = str(r['Post-nom'] ?? r['post_nom'] ?? r['POSTNOM'] ?? r['Postnom'] ?? '');
      const firstName = str(r['Prénom'] ?? r['prenom'] ?? r['PRENOM'] ?? r['Prenom'] ?? '');
      const rawSex = str(r['Sexe'] ?? r['sexe'] ?? r['SEX'] ?? '').toUpperCase();
      const sex = rawSex === 'M' || rawSex === 'GARÇON' || rawSex === 'GARCON' ? 'M'
                : rawSex === 'F' || rawSex === 'FILLE' ? 'F' : rawSex;
      const rawDate = str(r['Date de naissance'] ?? r['date_naissance'] ?? r['DateNaissance'] ?? '');
      const birthDate = normalizeDate(rawDate);
      const birthPlace = str(r['Lieu de naissance'] ?? r['lieu_naissance'] ?? r['LieuNaissance'] ?? '');
      const rawPhone = str(r['Téléphone tuteur'] ?? r['telephone_tuteur'] ?? r['Phone'] ?? r['phone'] ?? '');
      const guardianPhone = rawPhone ? normalizePhone(rawPhone) : '';
      const className = str(r['Classe'] ?? r['classe'] ?? r['CLASS'] ?? '');

      if (!lastName) errors.push('Nom manquant');
      if (!postName) errors.push('Post-nom manquant');
      if (!firstName) errors.push('Prénom manquant');
      if (sex !== 'M' && sex !== 'F') errors.push(`Sexe invalide "${rawSex}"`);
      if (!DATE_RE.test(birthDate)) errors.push(`Date invalide "${rawDate}"`);
      if (!birthPlace) errors.push('Lieu de naissance manquant');
      if (guardianPhone && !PHONE_RE.test(guardianPhone)) {
        warnings.push(`Téléphone "${guardianPhone}" invalide (ignoré)`);
      }
      if (!className) errors.push('Classe manquante');
      else if (!sectionMap.has(className.toLowerCase())) {
        errors.push(`Classe "${className}" introuvable`);
      }

      preview.push({ line: i + 2, lastName, postName, firstName, sex, birthDate, birthPlace, guardianPhone, className, errors, warnings });
    }

    const stats = {
      ok: preview.filter(r => r.errors.length === 0 && r.warnings.length === 0).length,
      warnings: preview.filter(r => r.errors.length === 0 && r.warnings.length > 0).length,
      errors: preview.filter(r => r.errors.length > 0).length,
    };
    return { rows: preview, stats };
  }
}
