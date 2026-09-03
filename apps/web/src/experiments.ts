export interface ExperimentDay {
  id: string
  index: string
  title: string
  subtitle: string
  status: 'available' | 'soon'
}

export const experimentDays: ExperimentDay[] = [
  {
    id: 'day-01',
    index: '01',
    title: 'День 01',
    subtitle: 'Stateless-чат: один вопрос — один ответ',
    status: 'available',
  },
  { id: 'day-02', index: '02', title: 'День 02', subtitle: 'Скоро', status: 'soon' },
  { id: 'day-03', index: '03', title: 'День 03', subtitle: 'Скоро', status: 'soon' },
]

export function findDay(dayId: string): ExperimentDay | undefined {
  return experimentDays.find((day) => day.id === dayId)
}
