/*
  Warnings:

  - You are about to drop the column `password` on the `admin_users` table. All the data in the column will be lost.
  - Added the required column `passwordHash` to the `admin_users` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "admin_users" DROP COLUMN "password",
ADD COLUMN     "passwordHash" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "members" ADD COLUMN     "passwordHash" TEXT;
