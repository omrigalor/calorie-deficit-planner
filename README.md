# Calorie & Deficit Planner

A goal-based calorie tracker and weight-loss deficit planner. Self-contained React app — no backend, persists to `localStorage`.

This independent personal project contains no employer, client, patient, or
proprietary company data. It is an educational planning tool, not medical advice.

## Features
- **Profile → BMR/TDEE** via Mifflin–St Jeor, with activity multipliers.
- **Deficit planning** — set a target daily intake, get a precise days-to-goal-weight forecast (`weight to lose × 7700 kcal/kg ÷ daily deficit`).
- **Food log** with automatic macro inference (protein / carbs / fat / fiber) from a keyword nutrient database when you don't supply them, plus a daily diet-quality read.
- **Exercise** → calories burned (steps + elliptical, MET-based), added back to the budget.
- **History calendar** — review past days and edit any day's food/exercise after the fact.
- Imperial/metric units.

## Run
```bash
npm install
npm run dev
```

## Stack
React 19 · Vite · Tailwind CSS v4. All logic is client-side and self-contained in `src/CalorieTracker.jsx`.
