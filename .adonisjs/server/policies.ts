export const policies = {
  ChildPolicy: () => import('#policies/child_policy'),
  ParentPolicy: () => import('#policies/parent_policy'),
  SchoolPolicy: () => import('#policies/school_policy'),
}

