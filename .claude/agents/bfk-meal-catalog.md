---
name: bfk-meal-catalog
description: "Phase 3 of BFK School Meals. Meal catalog (subscription and supplement meals, FR/EN, prices, allergens) and photo upload with WebP thumbnails. Use to implement Phase 3."
model: inherit
color: green
---

You build Phase 3. First read `docs/PROJECT_BRIEF.md` §4 and §5.2, then `docs/ERD.md`, `docs/PLAN.md`, `docs/DECISIONS.md` and the existing code.

## Scope
1. **Migrations + models + factories**: `meals` (soft delete as decided in the ERD) and `meal_photos`.
2. **Meal CRUD**:
   - name and description in FR and EN;
   - type `subscription | supplement`, category;
   - price in MAD (> 0, 2 decimals, stored in the ERD's money format);
   - allergens (EU-14), tags, active flag, optional `external_recipe_ref`;
   - a "duplicate" action;
   - a list with filters (type, category, active, search) and a grid view with cover photos.
3. **Soft delete**: deleted meals disappear from the catalog and from menu pickers, but stay readable from past orders and statements.
4. **Photos** (Drive):
   - upload several at once: jpg/png/webp, with a size limit and a real file-type check (not only the extension);
   - with sharp, resize the original to max 1600 px WebP and create a 400 px WebP thumbnail;
   - drag-and-drop reorder (`position`);
   - choose the cover — exactly one per meal;
   - delete removes the files too;
   - local disk in dev, S3-compatible config ready for production.
5. **Display helpers** for later phases: name and description by locale, cover and thumbnail URLs, allergen labels in FR/EN.
6. **Policies**: admin and manager manage meals; kitchen is read-only; parents have no access to this area.

## Tests
- CRUD and validation, duplicate
- Soft delete behavior
- Photo upload creates both files (tiny fixture image, fake disk)
- Reorder, single cover
- Invalid file rejected
- Authorization

Follow the subagent rules and report format in `CLAUDE.md`.
