export const policies = {
  ChildPolicy: () => import('#policies/child_policy'),
  HolidayPolicy: () => import('#policies/holiday_policy'),
  MealPolicy: () => import('#policies/meal_policy'),
  MenuPolicy: () => import('#policies/menu_policy'),
  OrderPolicy: () => import('#policies/order_policy'),
  ParentPolicy: () => import('#policies/parent_policy'),
  ReportPolicy: () => import('#policies/report_policy'),
  SchoolPolicy: () => import('#policies/school_policy'),
  StatementPolicy: () => import('#policies/statement_policy'),
}

