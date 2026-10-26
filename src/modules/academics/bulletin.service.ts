import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { eq, and } from 'drizzle-orm';
import { randomBytes } from 'crypto';
import { dbOwner } from '../../db/client.js';
import type { TxDB } from '../../db/client.js';
import {
  bulletin,
  enrollment,
  student,
  classSection,
  period,
  academicYear,
  mark,
  subject,
  attendance,
} from '../../db/schema.js';
import { SMS_SENDER, type SmsSender } from '../notifications/sms-sender.interface.js';
import { MarkService } from './mark.service.js';

interface GotenbergOptions {
  url: string;
}

@Injectable()
export class BulletinService {
  private gotenbergUrl: string;

  constructor(
    @Inject(SMS_SENDER) private readonly sms: SmsSender,
    @Inject(MarkService) private readonly markService: MarkService,
  ) {
    this.gotenbergUrl = process.env['GOTENBERG_URL'] ?? 'http://localhost:3002';
  }

  async listBySection(schoolId: string, classSectionId: string, periodId: string) {
    const enrolled = await dbOwner
      .select({ studentId: enrollment.studentId })
      .from(enrollment)
      .where(
        and(
          eq(enrollment.schoolId, schoolId),
          eq(enrollment.classSectionId, classSectionId),
          eq(enrollment.status, 'active'),
        ),
      );

    const bulletins = await dbOwner
      .select()
      .from(bulletin)
      .where(
        and(
          eq(bulletin.schoolId, schoolId),
          eq(bulletin.classSectionId, classSectionId),
          eq(bulletin.periodId, periodId),
        ),
      );

    const bulletinMap = new Map(bulletins.map((b) => [b.studentId, b]));
    return enrolled.map((e) => ({
      studentId: e.studentId,
      bulletin: bulletinMap.get(e.studentId) ?? null,
    }));
  }

  async sectionStatus(schoolId: string, yearId: string) {
    const sections = await dbOwner
      .select({ id: classSection.id, name: classSection.name })
      .from(classSection)
      .where(and(eq(classSection.schoolId, schoolId), eq(classSection.yearId, yearId)));

    const activePeriod = await dbOwner
      .select()
      .from(period)
      .where(and(eq(period.schoolId, schoolId), eq(period.yearId, yearId)))
      .then((rows) => rows.find((p) => p.status !== 'open') ?? rows[0] ?? null);

    if (!activePeriod) return sections.map((s) => ({ ...s, notesPercent: 0, status: 'missing_notes' as const, bulletinCount: 0 }));

    const result = await Promise.all(
      sections.map(async (sec) => {
        const enrolled = await dbOwner
          .select({ n: dbOwner.$count(enrollment.id) })
          .from(enrollment)
          .where(and(eq(enrollment.classSectionId, sec.id), eq(enrollment.status, 'active')))
          .then((r) => Number(r[0]?.n ?? 0));

        const subjects = await dbOwner
          .select({ id: subject.id })
          .from(subject)
          .where(eq(subject.classSectionId, sec.id));

        const total = enrolled * subjects.length;

        const filled = await dbOwner
          .select({ n: dbOwner.$count(mark.id) })
          .from(mark)
          .where(and(eq(mark.schoolId, schoolId), eq(mark.periodId, activePeriod.id)))
          .then((r) => Number(r[0]?.n ?? 0));

        const notesPercent = total > 0 ? Math.min(100, Math.round((filled / total) * 100)) : 0;

        const publishedBulletins = await dbOwner
          .select({ n: dbOwner.$count(bulletin.id) })
          .from(bulletin)
          .where(
            and(
              eq(bulletin.classSectionId, sec.id),
              eq(bulletin.periodId, activePeriod.id),
              eq(bulletin.schoolId, schoolId),
            ),
          )
          .then((r) => Number(r[0]?.n ?? 0));

        let status: 'missing_notes' | 'in_progress' | 'ready' | 'published';
        if (notesPercent < 100) status = notesPercent === 0 ? 'missing_notes' : 'in_progress';
        else if (publishedBulletins >= enrolled && enrolled > 0) status = 'published';
        else status = 'ready';

        return { ...sec, notesPercent, status, bulletinCount: publishedBulletins, periodId: activePeriod.id };
      }),
    );

    return result;
  }

  async generate(tx: TxDB, schoolId: string, classSectionId: string, periodId: string, yearId: string, publishedBy: string) {
    const results = await this.markService.computeResults(schoolId, classSectionId, periodId);
    if (!results) throw new NotFoundException('Period or section not found');

    const [sec] = await dbOwner.select().from(classSection).where(eq(classSection.id, classSectionId)).limit(1);
    const [yr] = await dbOwner.select().from(academicYear).where(eq(academicYear.id, yearId)).limit(1);

    const generated: Array<{ studentId: string; bulletinId: string; token: string }> = [];

    const subjects = 'subjects' in results ? results.subjects : [];
    const totalMax = 'totalMax' in results ? (results.totalMax as number) : 0;

    for (const row of results.rows) {
      const token = randomBytes(32).toString('hex');
      const rank = (row as typeof row & { rank?: number | null }).rank ?? null;

      const html = this.buildBulletinHtml({
        schoolId,
        student: row.student,
        section: sec?.name ?? '',
        year: yr?.label ?? '',
        period: results.period,
        subjects: subjects.map((s) => {
          const item: { id: string; name: string; maxPeriod: number; maxExam?: number } = { id: s.id, name: s.name, maxPeriod: s.maxPeriod };
          if (s.maxExam !== null) item.maxExam = s.maxExam;
          return item;
        }),
        scores: row.subjectScores,
        total: row.total,
        totalMax,
        pct: row.pct,
        rank,
      });

      const pdfBuffer = await this.renderPdf(html);
      const pdfRef = `bulletins/${schoolId}/${periodId}/${row.student.id}.pdf`;

      const [existing] = await dbOwner
        .select()
        .from(bulletin)
        .where(
          and(
            eq(bulletin.studentId, row.student.id),
            eq(bulletin.periodId, periodId),
            eq(bulletin.schoolId, schoolId),
          ),
        )
        .limit(1);

      let b: typeof existing;
      if (existing) {
        const [updated] = await tx
          .update(bulletin)
          .set({ pdfRef, publicToken: token, publishedAt: new Date() })
          .where(eq(bulletin.id, existing.id))
          .returning();
        b = updated!;
      } else {
        const [inserted] = await tx
          .insert(bulletin)
          .values({
            schoolId,
            studentId: row.student.id,
            classSectionId,
            periodId,
            yearId,
            pdfRef,
            publicToken: token,
            publishedAt: new Date(),
          })
          .returning();
        b = inserted!;
      }

      generated.push({ studentId: row.student.id, bulletinId: b!.id, token });
    }

    return generated;
  }

  async getByToken(token: string) {
    const [row] = await dbOwner
      .select()
      .from(bulletin)
      .where(eq(bulletin.publicToken, token))
      .limit(1);
    return row ?? null;
  }

  private buildBulletinHtml(opts: {
    schoolId: string;
    student: { id: string; lastName: string; firstName: string; postName: string };
    section: string;
    year: string;
    period: { label: string; kind: string };
    subjects: Array<{ id: string; name: string; maxPeriod: number; maxExam?: number }>;
    scores: Array<{ subjectId: string; score: number | null; max: number }>;
    total: number;
    totalMax: number;
    pct: number;
    rank: number | null;
  }): string {
    const { student, section, year, period, subjects, scores, total, totalMax, pct, rank } = opts;
    const scoreMap = new Map(scores.map((s) => [s.subjectId, s]));

    const rows = subjects.map((sub) => {
      const sc = scoreMap.get(sub.id);
      const score = sc?.score ?? null;
      const max = sc?.max ?? sub.maxPeriod;
      const pctSub = score !== null ? Math.round((score / max) * 100) : null;
      const color = pctSub === null ? '#6b7280' : pctSub < 50 ? '#dc2626' : pctSub < 70 ? '#d97706' : '#16a34a';
      return `<tr><td>${sub.name}</td><td style="text-align:center">${score ?? '—'}</td><td style="text-align:center">${max}</td><td style="text-align:center;color:${color};font-weight:600">${pctSub !== null ? pctSub + '%' : '—'}</td></tr>`;
    }).join('');

    return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
      body{font-family:Arial,sans-serif;font-size:12px;padding:24px;color:#111}
      h1{font-size:18px;text-align:center;margin-bottom:4px}
      .sub{text-align:center;color:#555;margin-bottom:20px}
      table{width:100%;border-collapse:collapse;margin-top:8px}
      th,td{border:1px solid #ddd;padding:6px 10px}
      th{background:#1a1a2e;color:#fff;font-weight:600}
      .summary{display:flex;gap:24px;margin-top:16px;justify-content:center}
      .summary-item{text-align:center;padding:8px 16px;border:1px solid #ddd;border-radius:6px}
      .summary-item .val{font-size:22px;font-weight:700;color:#1a1a2e}
      .summary-item .lbl{font-size:11px;color:#555}
    </style></head><body>
    <h1>BULLETIN DE NOTES</h1>
    <div class="sub">${year} · ${period.label} · ${section}</div>
    <table><tr><td><strong>Élève:</strong> ${student.lastName} ${student.postName} ${student.firstName}</td><td><strong>Classe:</strong> ${section}</td></tr></table>
    <table style="margin-top:16px"><thead><tr><th>Matière</th><th>Note</th><th>Max</th><th>%</th></tr></thead><tbody>${rows}</tbody></table>
    <div class="summary">
      <div class="summary-item"><div class="val">${total}/${totalMax}</div><div class="lbl">Total</div></div>
      <div class="summary-item"><div class="val">${pct}%</div><div class="lbl">Moyenne</div></div>
      <div class="summary-item"><div class="val">${rank ?? '—'}</div><div class="lbl">Rang</div></div>
    </div>
    </body></html>`;
  }

  private async renderPdf(html: string): Promise<Buffer> {
    const form = new FormData();
    const blob = new Blob([html], { type: 'text/html' });
    form.append('files', blob, 'index.html');
    form.append('paperWidth', '8.27');
    form.append('paperHeight', '11.7');
    form.append('marginTop', '0.5');
    form.append('marginBottom', '0.5');
    form.append('marginLeft', '0.5');
    form.append('marginRight', '0.5');

    const res = await fetch(`${this.gotenbergUrl}/forms/chromium/convert/html`, {
      method: 'POST',
      body: form,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Gotenberg error ${res.status}: ${text}`);
    }

    return Buffer.from(await res.arrayBuffer());
  }
}
