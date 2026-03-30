import 'dotenv/config';
import Retell from 'retell-sdk';

const client = new Retell({ apiKey: process.env.RETELL_API_KEY });
const FLOW_ID = 'conversation_flow_710161ccad8e';
const NEW_URL = process.argv[2];

if (!NEW_URL) {
  console.error('Usage: node update-flow-urls.mjs <ngrok-url>');
  process.exit(1);
}

async function main() {
  const flow = await client.conversationFlow.retrieve(FLOW_ID);

  const updatedTools = flow.tools.map(tool => {
    if (tool.type === 'custom') {
      return { ...tool, url: NEW_URL };
    }
    return tool;
  });

  await client.conversationFlow.update(FLOW_ID, { tools: updatedTools });
  console.log(`Flow ${FLOW_ID} — ${updatedTools.filter(t => t.type === 'custom').length} tool URL updated to: ${NEW_URL}`);
}

main().catch(err => {
  console.error('Failed:', err.message);
  if (err.error) console.error(JSON.stringify(err.error, null, 2));
  process.exit(1);
});
