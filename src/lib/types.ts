export { TransactionType, Currency, Role } from '@prisma/client';
export type { FixedAsset, Transaction, Account } from '@prisma/client';

// Common action result types
export interface ActionResult<T = void> {
  success: boolean;
  message?: string;
  error?: string;
  errors?: string[];
  data?: T;
}

export type ActionState<T = void> = ActionResult<T> | null;

// Error handling types
export interface ValidationError {
  field: string;
  message: string;
}

export interface ApiError {
  message: string;
  code?: string;
  details?: unknown;
}

// Common data types
export interface PaginationParams {
  page?: number;
  limit?: number;
  offset?: number;
}

export interface SortParams {
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}

// Form data types
export interface FormActionState {
  success: boolean;
  message?: string;
  error?: string;
  errors?: ValidationError[];
}
