/**
 * Shared API entity interfaces — the JSON contract returned by the backend.
 * These mirror the TypeBox response schemas and are safe to copy to the
 * frontend (see frontend/src/types/api.ts) to keep both ends in sync.
 */

export type MealType = 'BREAKFAST' | 'LUNCH' | 'DINNER' | 'SNACK' | 'OTHER';

export interface AuthUser {
  id: string;
  email: string;
  displayName: string | null;
}

export interface SessionResponse {
  accessToken: string;
  user: AuthUser;
}

export interface InitiationResponse {
  initiationToken: string;
  pinAlreadySet: boolean;
}

export interface WeightEntry {
  id: string;
  weightKg: number;
  loggedFor: string; // YYYY-MM-DD
  note: string | null;
  createdAt: string; // ISO timestamp
}

export interface MealItem {
  id: string;
  name: string;
  grams: number;
  calories: number;
  proteins: number;
  fats: number;
  carbs: number;
}

export interface MacroTotals {
  calories: number;
  proteins: number;
  fats: number;
  carbs: number;
}

export interface Meal {
  id: string;
  name: string;
  mealType: MealType;
  loggedFor: string;
  createdAt: string;
  items: MealItem[];
  totals: MacroTotals;
}

export interface DashboardDailyPoint {
  date: string;
  calories: number;
  proteins: number;
  fats: number;
  carbs: number;
  weightKg: number | null;
}

export interface DashboardResponse {
  rangeDays: number;
  dailyCalorieGoal: number | null;
  series: DashboardDailyPoint[];
  summary: {
    avgCalories: number;
    latestWeightKg: number | null;
    weightChangeKg: number | null;
    daysLogged: number;
  };
}
