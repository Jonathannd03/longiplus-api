export type StaffRole =
  | 'owner'
  | 'director'
  | 'bursar'
  | 'secretary'
  | 'teacher'
  | 'class_teacher'
  | 'longiplus_admin';

export interface AuthenticatedUser {
  keycloakUserId: string;
  email: string;
  role: StaffRole;
  schoolId: string;
}
