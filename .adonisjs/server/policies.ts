export const policies = {
  ChildPolicy: () => import('#policies/child_policy'),
  MealPolicy: () => import('#policies/meal_policy'),
  ParentPolicy: () => import('#policies/parent_policy'),
  SchoolPolicy: () => import('#policies/school_policy'),
}

