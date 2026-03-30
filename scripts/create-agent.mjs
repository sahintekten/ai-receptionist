import 'dotenv/config';
import Retell from 'retell-sdk';

const RETELL_API_KEY = process.env.RETELL_API_KEY;
if (!RETELL_API_KEY) {
  console.error('RETELL_API_KEY environment variable is not set.');
  process.exit(1);
}

const client = new Retell({ apiKey: RETELL_API_KEY });

const FLOW_ID = 'conversation_flow_710161ccad8e';
const VOICE_ID = 'cartesia-Cleo';

async function main() {
  console.log('Creating agent: Tekten Klinik - TEST');
  console.log('Voice:', VOICE_ID);
  console.log('Flow:', FLOW_ID);

  const agent = await client.agent.create({
    agent_name: 'Tekten Klinik - TEST',
    voice_id: VOICE_ID,
    response_engine: {
      type: 'conversation-flow',
      conversation_flow_id: FLOW_ID,
    },
    language: 'tr-TR',
    enable_backchannel: true,
    backchannel_words: ['evet', 'anlıyorum', 'tabii'],
    backchannel_frequency: 0.8,
    boosted_keywords: [
      'Tekten', 'Güneş Tekten', 'Bahattin Çeliköz',
      'rinoplasti', 'liposuction', 'mide balonu',
      'blefaroplasti', 'jinekomasti', 'bişektomi',
    ],
    normalize_for_speech: true,
    interruption_sensitivity: 0.8,
    enable_dynamic_responsiveness: true,
  });

  console.log('\n╔══════════════════════════════════════════════════╗');
  console.log('║            AGENT OLUŞTURULDU                     ║');
  console.log('╠══════════════════════════════════════════════════╣');
  console.log(`║  Agent ID:   ${agent.agent_id}`);
  console.log(`║  Agent Name: ${agent.agent_name}`);
  console.log(`║  Voice:      ${agent.voice_id}`);
  console.log(`║  Language:   ${agent.language}`);
  console.log('╚══════════════════════════════════════════════════╝');
}

main().catch(err => {
  console.error('FAILED:', err.message);
  if (err.status) console.error('HTTP Status:', err.status);
  if (err.error) console.error('Error body:', JSON.stringify(err.error, null, 2));
  process.exit(1);
});
