import { loadConfig } from '../src/config.js';
import { LarkClient } from '../src/lark.js';
import { StudioAgent } from '../src/agent.js';

const config = loadConfig();
const lark = new LarkClient(config);
const agent = new StudioAgent(config, lark);

await agent.refreshRuntimeMappings();
const result = await agent.sendRouteReviewDigests();

console.log(JSON.stringify({
  ok: true,
  delivery: 'private-only',
  ...result,
}, null, 2));
