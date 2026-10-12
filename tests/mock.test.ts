// © 2026 typeof (Scolup) | Licensed under AGPL 3.0
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { Litedirecte } from '../src/index';
import { createTestClient, seedSession, testAccount } from './setup';

describe('mockMode', () => {
  let ld: Litedirecte;

  beforeEach(async () => {
    ({ ld } = createTestClient());
    await seedSession(ld.ctx.config.storage!, ld, testAccount(), 'test_token');
  });

  afterEach(() => {
    ld.destroy();
  });

  it('returns raw-shaped grades without making network calls', async () => {
    const grades = await ld.grades.getGrades({ mockMode: true });
    expect(grades.notes).toBeArray();
    expect(grades.notes[0].date).toBeInstanceOf(Date);
    expect(grades.parametrage.libelleEval1).toBe('Très insuffisante');
  });

  it('returns raw-shaped messages and decodes content in detail', async () => {
    const messages = await ld.messages.getMessages({ mockMode: true });
    expect(messages.messages.received[0].subject).toBeString();

    const detail = await ld.messages.getMessage(12345, { mockMode: true });
    expect(detail.content).toContain('ATTENTION');
    expect(detail.content).not.toMatch(/^[A-Za-z0-9+/]+=*$/);
  });

  it('returns mock contacts usable as sendMessage recipients', async () => {
    ld.ctx.account = testAccount({
      profile: { sexe: 'M', photo: '', classe: { id: 17, code: 'T1', libelle: 'TERMINALE 1' } },
    });
    const { contacts } = await ld.messages.getContacts({ mockMode: true });
    expect(contacts.length).toBeGreaterThan(0);
    expect(contacts.some((c: any) => c.type === 'P' && typeof c.id === 'number')).toBe(true);
  });

  it('covers attendance, homework, timetable, documents, timeline, cloud, qcms', async () => {
    const attendance = await ld.attendance.getAttendance({ mockMode: true });
    expect(attendance.absencesRetards[0].date).toBeInstanceOf(Date);

    const homework = await ld.homework.getHomework({ mockMode: true });
    expect(Object.keys(homework)).toContain('2026-03-24');

    const timetable = await ld.timetable.getTimetable({ mockMode: true });
    expect(timetable[0].start_date).toBeInstanceOf(Date);

    const documents = await ld.documents.getDocuments({ mockMode: true });
    expect(documents.notes).toBeArray();

    const timeline = await ld.timeline.getTimeline({ mockMode: true });
    expect(timeline[0].typeElement).toBe('Note');

    const common = await ld.timeline.getCommonTimeline({ mockMode: true });
    expect(common.postits[0].contenu).toContain('evoDirecte');

    const cloud = await ld.cloud.getCloud({ mockMode: true });
    expect(cloud[0].type).toBe('folder');

    const qcms = await ld.qcms.getQcms({ mockMode: true });
    expect(qcms[0].idQCM).toBe(149);

    const qcm = await ld.qcms.getQcmDetail(149, 237, { mockMode: true });
    expect(qcm.questions[0].question).toContain('Punta Cana');
  });
});
