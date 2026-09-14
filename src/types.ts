export type Role = 'admin' | 'director' | 'employee'

export type Person = {
  id: number
  name: string
  email?: string
  role: Role
  active: number
}

export type Company = {
  id: number
  name: string
  contact: string
  email: string
  phone: string
  notes: string
  owner_id: number
  status: string
}

export type Task = {
  id: number
  company_id: number
  assignee_id: number
  title: string
  description: string
  due: string
  priority: string
  status: string
  series_id: number | null
  occurrence_on: string | null
  source: string
}

export type TaskSeries = {
  id: number
  company_id: number
  assignee_id: number
  title: string
  description: string
  priority: string
  cadence: 'daily' | 'weekly' | 'monthly' | 'yearly'
  interval_n: number
  starts_on: string
  ends_on: string | null
  next_occurrence_on: string
  active: number
}

export type DailyPlan = {
  id: number
  user_id: number
  name: string
  plan_date: string
  planned_start: string
  planned_minutes: number
  title: string
  details: string
  company_id: number | null
  company_name: string | null
  task_id: number | null
  task_title: string | null
  status: string
}

export type Leave = {
  id: number
  user_id: number
  name: string
  start: string
  end: string
  leave_type: string
  note: string
  status: string
  reviewer_id: number | null
  reviewer_name: string | null
  decision_note: string
}

export type CalendarEvent = {
  id: number
  title: string
  date: string
  time: string
  description: string
  created_by: number
}

export type Activity = {
  id: number
  user_id: number
  actor: string
  message: string
  created: string
  seen: number
  kind: string
  importance: string
  target_path: string
}

export type CrmState = {
  user: Person
  users: Person[]
  companies: Company[]
  tasks: Task[]
  series: TaskSeries[]
  plans: DailyPlan[]
  leaves: Leave[]
  leaveTypes: string[]
  events: CalendarEvent[]
  activity: Activity[]
}
