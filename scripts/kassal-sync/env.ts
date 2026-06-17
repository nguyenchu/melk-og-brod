import { config } from 'dotenv';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Last scripts/kassal-sync/.env uansett hvilken cwd prosessen startes med.
const here = dirname(fileURLToPath(import.meta.url));
config({ path: join(here, '.env') });
