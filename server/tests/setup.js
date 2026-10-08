// Runs before every test file. Points the app at the TEST database.
import dotenv from 'dotenv';

dotenv.config();

// Remember the real (dev/prod) URL so the safety guard can compare against it
process.env.__DEV_DATABASE_URL = process.env.DATABASE_URL || '';

if (process.env.TEST_DATABASE_URL) {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
}
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-only-secret';