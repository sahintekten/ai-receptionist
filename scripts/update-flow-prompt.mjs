import 'dotenv/config';
import Retell from 'retell-sdk';

const client = new Retell({ apiKey: process.env.RETELL_API_KEY });
const FLOW_ID = 'conversation_flow_710161ccad8e';

async function main() {
  const flow = await client.conversationFlow.retrieve(FLOW_ID);

  // 1. Update global prompt — add dynamic date/time variables at the top
  const dateBlock = `TARİH VE SAAT BİLGİSİ:
- Şu anki tarih ve saat: {{current_time_Europe/Istanbul}}
- 14 günlük takvim: {{current_calendar_Europe/Istanbul}}
- Arayanın numarası: {{user_number}}
- Çağrı yönü: {{direction}}

`;

  let updatedGlobalPrompt = flow.global_prompt;
  if (!updatedGlobalPrompt.includes('current_time_Europe/Istanbul')) {
    updatedGlobalPrompt = dateBlock + updatedGlobalPrompt;
  }

  // 2. Update booking node prompt — enforce name+phone collection before create_booking
  const updatedNodes = flow.nodes.map(node => {
    if (node.id === 'node_booking') {
      return {
        ...node,
        instruction: {
          type: 'prompt',
          text: `Hastanın randevu talebini yönet.

BİLGİ TOPLAMA SIRASI (hepsini toplamadan create_booking ÇAĞIRMA):
1. Hangi işlem/hizmet için? (Buna göre doktoru belirle: obezite/mide balonu → Dr. Güneş Tekten, estetik → Prof. Dr. Bahattin Çeliköz)
2. Tercih edilen tarih ve saat
3. check_availability ile uygunluk kontrol et
4. Uygun slot varsa hastaya söyle ve onay al
5. Hastanın ADI SOYADI — mutlaka sor: "Adınızı ve soyadınızı alabilir miyim efendim?"
6. Hastanın TELEFON NUMARASI — mutlaka sor: "Ulaşabileceğimiz telefon numaranızı alabilir miyim efendim?" ({{user_number}} zaten varsa doğrulat: "Sizi bu numaradan arayabilir miyiz?")

ZORUNLU KURAL:
- İsim ve telefon numarası ALINMADAN create_booking ASLA çağırılmamalı
- create_booking çağrılmadan kapanışa GEÇİLMEMELİ — hasta onayladıysa randevu mutlaka oluşturulmalı
- Randevu oluşturulduktan sonra detayları sözlü onayla: tarih, saat, doktor adı

EK KURALLAR:
- Fiyat sorulursa: "Fiyatlarımız muayene sonrasında belirleniyor efendim"
- Uygun slot yoksa alternatif tarihler öner veya mesaj bırakmayı teklif et
- Hasta vazgeçerse kapanışa yönlendir`,
        },
      };
    }
    return node;
  });

  await client.conversationFlow.update(FLOW_ID, {
    global_prompt: updatedGlobalPrompt,
    nodes: updatedNodes,
  });

  console.log('Flow updated:');
  console.log('  - Global prompt: dynamic date/time variables added');
  console.log('  - Booking node: name+phone enforcement applied');
}

main().catch(err => {
  console.error('Failed:', err.message);
  if (err.error) console.error(JSON.stringify(err.error, null, 2));
  process.exit(1);
});
