// © 2026 typeof (Scolup) | Licensed under AGPL 3.0
const WEEKDAY_NAMES = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
] as const;

export type CorrelationType =
  | 'gradeVsPresence'
  | 'gradeVsDayOfWeek'
  | 'gradeVsTimeOfDay'
  | 'homeworkVsGrade'
  | 'gradeTrend';

export interface Correlation {
  type: CorrelationType;
  subject: string;
  finding: string;
  data: Record<string, number>;
  confidence: number;
  observations: number;
}

export function correlateGrades(gradesData: unknown): Correlation[] {
  const correlations: Correlation[] = [];
  const grades = (gradesData as any).notes || [];
  const subjectGrades = groupGradesBySubject(grades);

  subjectGrades.forEach((gradeList, subject) => {
    const values: number[] = [];
    const validGradeList: any[] = [];

    for (const g of gradeList) {
      if (g.valeur == null || g.noteSur == null) {
        continue;
      }
      const parsedVal = parseFloat(String(g.valeur).replace(',', '.'));
      const parsedSur = parseFloat(String(g.noteSur).replace(',', '.'));

      if (isNaN(parsedVal) || isNaN(parsedSur) || parsedSur === 0) {
        continue;
      }

      values.push((parsedVal / parsedSur) * 20);
      validGradeList.push(g);
    }

    if (values.length < 5) return;

    correlations.push(analyzeGradeTrend(subject, values, values.length));
    correlations.push(analyzeDayOfWeekPattern(subject, validGradeList, values));
  });

  return correlations;
}

function groupGradesBySubject(grades: any[]): Map<string, any[]> {
  const map = new Map<string, any[]>();

  for (const grade of grades) {
    const list = map.get(grade.libelleMatiere) || [];
    list.push(grade);
    map.set(grade.libelleMatiere, list);
  }

  return map;
}

function analyzeGradeTrend(subject: string, values: number[], count: number): Correlation {
  return {
    type: 'gradeTrend',
    subject,
    finding: 'calculated_trend',
    data: { average: values.reduce((a, b) => a + b, 0) / values.length },
    confidence: Math.min(count / 15, 1),
    observations: count,
  };
}

function analyzeDayOfWeekPattern(subject: string, gradeList: any[], values: number[]): Correlation {
  const dowGrades: Record<string, number[]> = {};

  gradeList.forEach((grade, i) => {
    const day = WEEKDAY_NAMES[new Date(grade.date).getDay()] ?? 'Unknown';
    const list = dowGrades[day] || [];
    list.push(values[i]);
    dowGrades[day] = list;
  });

  const dowStats: Record<string, number> = {};
  Object.entries(dowGrades).forEach(([day, vals]) => {
    dowStats[day] = vals.reduce((a, b) => a + b, 0) / vals.length;
  });

  return {
    type: 'gradeVsDayOfWeek',
    subject,
    finding: 'weekly_variation',
    data: dowStats,
    confidence: 0.5,
    observations: gradeList.length,
  };
}
