-- AlterTable
ALTER TABLE "users" ADD COLUMN     "carb_target_g" INTEGER,
ADD COLUMN     "fat_target_g" INTEGER,
ADD COLUMN     "goal_type" TEXT,
ADD COLUMN     "protein_target_g" INTEGER;
