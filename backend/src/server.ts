import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from './app';
import { resolveTutorClient } from './routes/tutor';

const here = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT ?? 8787);
const host = process.env.HOST ?? '127.0.0.1';
const dataDir = path.resolve(process.env.OHMLAB_DATA_DIR ?? path.join(here, '..', 'data'));
const staticDir = path.resolve(here, '..', '..', 'frontend', 'dist');

const tutor = await resolveTutorClient();
const app = createApp({ dataDir, anthropic: tutor.client, staticDir });

app.listen(port, host, () => {
  console.log(`Ohmlab backend listening on http://${host}:${port}`);
  console.log(`  saved circuits: ${dataDir}`);
  console.log(`  AI tutor: ${tutor.reason}`);
});
