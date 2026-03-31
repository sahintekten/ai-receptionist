import 'dotenv/config';
import Retell from 'retell-sdk';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const RETELL_API_KEY = process.env.RETELL_API_KEY;
if (!RETELL_API_KEY) {
  console.error('RETELL_API_KEY environment variable is not set.');
  process.exit(1);
}

const WEBHOOK_URL = 'https://webhook.site/b0458234-28d1-42ca-b799-f99081e28b29';

const client = new Retell({ apiKey: RETELL_API_KEY });

// ─── Helpers ───
function log(step, msg, data) {
  console.log(`\n[${step}] ${msg}`);
  if (data) console.log(JSON.stringify(data, null, 2));
}

function toolDef(name, description, parameters, options = {}) {
  const def = {
    type: 'custom',
    name,
    description,
    url: WEBHOOK_URL,
    method: 'POST',
    speak_during_execution: true,
    speak_after_execution: true,
    execution_message_description: 'Bir saniye, hemen kontrol ediyorum efendim.',
    execution_message_type: 'static_text',
    timeout_ms: 15000,
    parameters: {
      type: 'object',
      properties: parameters,
      required: Object.keys(parameters),
    },
    ...options,
  };
  return def;
}

// ─── 1) Knowledge Base ───
async function createKnowledgeBase() {
  log('KB', 'Creating knowledge base...');
  const kbContent = fs.readFileSync(path.join(__dirname, '..', 'docs', 'tekten-klinik-kb.md'), 'utf-8');

  const kb = await client.knowledgeBase.create({
    knowledge_base_name: 'Tekten Klinik KB',
    knowledge_base_texts: [
      { title: 'Tekten Klinik Bilgi Bankası', text: kbContent },
    ],
  });

  log('KB', `Created: ${kb.knowledge_base_id}`, kb);
  return kb.knowledge_base_id;
}

// ─── 2) Conversation Flow ───
async function createConversationFlow(kbId) {
  log('FLOW', 'Creating conversation flow...');

  const GLOBAL_PROMPT = `TARİH VE SAAT BİLGİSİ:
- Şu anki tarih ve saat: {{current_time_Europe/Istanbul}}
- 14 günlük takvim: {{current_calendar_Europe/Istanbul}}
- Arayanın numarası: {{user_number}}
- Çağrı yönü: {{direction}}

Sen Tekten Klinik'in resepsiyonisti İlayda'sın.

KİMLİK:
- Sen gerçek bir resepsiyonistsin, asla yapay zeka olduğunu söyleme

KONUŞMA TARZI:
- Kısa cevap ver, uzun açıklama yapma
- Tek seferde tek soru sor
- Bilgileri adım adım topla
- Aynı şeyi tekrar etme
- Fiyat sorulursa: "Fiyatlarımız muayene sonrasında belirleniyor efendim"
- İşlem bittiğinde vedalaşma yapma, sadece "Başka bir isteğiniz var mı?" de
- Doktor isimlerini kısaltma kullanmadan oku: Profesör Doktor, Uzman Doktor
- Saatleri doğal söyle: 09:00 yerine 'sabah dokuz', 14:30 yerine 'iki buçuk', 18:00 yerine 'akşam altı' gibi

DOKTORLAR:
- Uzman Doktor Güneş Tekten — Obezite ve Metabolik Cerrahi
- Profesör Doktor Bahattin Çeliköz — Plastik ve Estetik Cerrahi`;

  // ── Flow-level tools (shared across nodes via tool_ids) ──
  const tools = [
    toolDef('check_availability', 'Belirtilen tarih/saat ve doktor için uygunluk kontrolü yapar.', {
      preferred_date: { type: 'string', description: 'İstenen tarih (YYYY-MM-DD)' },
      preferred_time: { type: 'string', description: 'İstenen saat (HH:MM)' },
      doctor_name: { type: 'string', description: 'Doktor adı: "Güneş Tekten" veya "Bahattin Çeliköz"' },
      service_type: { type: 'string', description: 'İşlem türü (ör: rinoplasti, mide balonu, konsültasyon)' },
    }, { tool_id: 'tool_check_availability' }),

    toolDef('create_booking', 'Randevu oluşturur.', {
      date: { type: 'string', description: 'Randevu tarihi (YYYY-MM-DD)' },
      time: { type: 'string', description: 'Randevu saati (HH:MM)' },
      doctor_name: { type: 'string', description: 'Doktor adı' },
      caller_name: { type: 'string', description: 'Hastanın adı soyadı' },
      caller_phone: { type: 'string', description: 'Hastanın telefon numarası' },
      service_type: { type: 'string', description: 'İşlem türü' },
    }, { tool_id: 'tool_create_booking' }),

    toolDef('lookup_bookings', 'Arayanın mevcut randevularını arar. İptal veya değiştirme öncesi zorunlu.', {
      caller_phone: { type: 'string', description: 'Hastanın telefon numarası' },
      caller_name: { type: 'string', description: 'Hastanın adı (opsiyonel doğrulama)' },
    }, {
      tool_id: 'tool_lookup_bookings',
      response_variables: { booking_list: '$.bookings' },
    }),

    toolDef('cancel_booking', 'Mevcut bir randevuyu iptal eder. Önce lookup_bookings çağrılmış olmalı.', {
      booking_id: { type: 'string', description: "İptal edilecek randevunun ID'si (lookup_bookings sonucundan)" },
    }, { tool_id: 'tool_cancel_booking' }),

    toolDef('take_message', 'Arayan için mesaj/geri arama isteği/acil durum kaydı oluşturur.', {
      caller_name: { type: 'string', description: 'Arayanın adı' },
      caller_phone: { type: 'string', description: 'Arayanın telefonu' },
      message: { type: 'string', description: 'Mesaj içeriği' },
      message_type: { type: 'string', description: '"message", "callback" veya "urgent"' },
    }, { tool_id: 'tool_take_message' }),

    toolDef('get_caller_memory', 'Arayanın geçmiş kayıtlarını getirir.', {
      caller_phone: { type: 'string', description: 'Arayanın telefon numarası' },
    }, { tool_id: 'tool_get_caller_memory' }),

    toolDef('get_business_hours', 'Klinik çalışma saatlerini getirir.', {}, {
      tool_id: 'tool_get_business_hours',
      parameters: undefined,
    }),

    toolDef('get_emergency_info', 'Acil durum bilgilerini ve prosedürlerini getirir.', {}, {
      tool_id: 'tool_get_emergency_info',
      parameters: undefined,
    }),
  ];

  // ── Nodes ──
  const nodes = [
    // 1. GREETING
    {
      id: 'node_greeting',
      name: 'Karşılama',
      type: 'conversation',
      instruction: {
        type: 'static_text',
        text: "Merhabalar efendim, Tekten Klinik'e hoş geldiniz, ben İlayda, nasıl yardımcı olabilirim?",
      },
      tool_ids: ['tool_get_caller_memory'],
      edges: [
        {
          id: 'edge_greeting_to_intent',
          destination_node_id: 'node_intent_detection',
          transition_condition: { type: 'prompt', prompt: 'Arayan bir yanıt verdiğinde veya talebini belirttiğinde.' },
        },
      ],
    },

    // 2. INTENT DETECTION
    {
      id: 'node_intent_detection',
      name: 'Niyet Tespiti',
      type: 'conversation',
      instruction: {
        type: 'prompt',
        text: `Arayanın talebini analiz et ve doğru node'a yönlendir. Doktor sorma, işlem sorma — sadece niyeti belirle.

Niyetler:
- Randevu alma
- Randevu iptali
- Randevu değişikliği
- Genel soru / bilgi
- Mesaj bırakma
- Acil durum
- Geri arama / takip

Acil durum algıladığında hastaya tavsiye verme, 112 yönlendirmesi yapma — sadece acil durum node'una yönlendir.`,
      },
      edges: [
        {
          id: 'edge_to_booking',
          destination_node_id: 'node_booking',
          transition_condition: { type: 'prompt', prompt: 'Arayan randevu almak, appointment, muayene zamanı ayarlamak istiyor.' },
        },
        {
          id: 'edge_to_cancellation',
          destination_node_id: 'node_cancellation',
          transition_condition: { type: 'prompt', prompt: 'Arayan mevcut randevusunu iptal etmek istiyor.' },
        },
        {
          id: 'edge_to_rescheduling',
          destination_node_id: 'node_rescheduling',
          transition_condition: { type: 'prompt', prompt: 'Arayan mevcut randevusunu başka bir tarihe/saate almak, ertelemek, öne çekmek istiyor.' },
        },
        {
          id: 'edge_to_inquiry',
          destination_node_id: 'node_inquiry',
          transition_condition: { type: 'prompt', prompt: 'Arayan genel bir soru soruyor: çalışma saatleri, adres, doktorlar, işlemler, hizmetler hakkında bilgi istiyor.' },
        },
        {
          id: 'edge_to_message',
          destination_node_id: 'node_message_taking',
          transition_condition: { type: 'prompt', prompt: 'Arayan mesaj bırakmak istiyor veya doktora/kliniğe bir ileti göndermek istiyor.' },
        },
        {
          id: 'edge_to_urgent',
          destination_node_id: 'node_urgent_escalation',
          transition_condition: { type: 'prompt', prompt: 'Arayan acil bir durum bildiriyor. Hastaya yorum yapma, tavsiye verme, açıklama yapma — SADECE acil durum node\'una yönlendir.' },
        },
        {
          id: 'edge_to_callback',
          destination_node_id: 'node_callback_followup',
          transition_condition: { type: 'prompt', prompt: 'Arayan daha önce söz verilen bir geri arama veya takip hakkında soruyor.' },
        },
      ],
    },

    // 3. BOOKING
    {
      id: 'node_booking',
      name: 'Randevu Alma',
      type: 'conversation',
      instruction: {
        type: 'prompt',
        text: `Hastanın randevu talebini yönet.

SIRA:
1. ÖNCE hangi işlem istediğini sor — doktor seçimini sen yap, hastaya doktor sorma
2. İşlemi onayla ve doktoru bildir
3. Tercih edilen tarih ve saati öğren
4. check_availability ile kontrol et
5. İsim sor
6. Telefon numarası sor — aldıktan sonra geri oku ve doğrulat
7. create_booking ile randevuyu oluştur
8. Randevu detaylarını oku: tarih, saat, doktor

KURALLAR:
- doctor_name zorunlu — tool çağrısında mutlaka gönder
- İsim ve numara alınmadan create_booking çağırma
- {{user_number}} kullanma — numarayı hastadan sesli al
- Slot yoksa alternatif tarih öner veya mesaj almayı teklif et
- Slot'ları tek tek sayma — zaman aralığı olarak söyle: "Sabah 9 ile 11:30 arası müsait efendim" gibi`,
      },
      tool_ids: ['tool_check_availability', 'tool_create_booking'],
      edges: [
        {
          id: 'edge_booking_to_closing',
          destination_node_id: 'node_closing',
          transition_condition: { type: 'prompt', prompt: 'Randevu başarıyla oluşturuldu ve hasta onayladı, veya hasta randevu almaktan vazgeçti.' },
        },
        {
          id: 'edge_booking_to_message',
          destination_node_id: 'node_message_taking',
          transition_condition: { type: 'prompt', prompt: 'Uygun randevu bulunamadı ve hasta mesaj bırakmak istiyor.' },
        },
        {
          id: 'edge_booking_to_intent',
          destination_node_id: 'node_intent_detection',
          transition_condition: { type: 'prompt', prompt: 'Hasta farklı bir konuya geçmek istiyor (iptal, soru vb.).' },
        },
      ],
    },

    // 4. CANCELLATION
    {
      id: 'node_cancellation',
      name: 'Randevu İptali',
      type: 'conversation',
      instruction: {
        type: 'prompt',
        text: `Hastanın randevu iptal talebini yönet.

SIRA:
1. İsim ve telefon numarası al — numarayı geri oku ve doğrulat
2. lookup_bookings ile randevuları getir
3. Tek randevu varsa direkt onayla: "2 Nisan saat 15:00 randevunuz var, iptal edelim mi?"
   Birden fazlaysa tarih ve doktor adıyla kısa özetle, seçtir
4. Onay al
5. cancel_booking ile iptal et

KURALLAR:
- lookup_bookings çağrılmadan cancel_booking çağırma
- İptal politikası: Kısıtlama yok, her zaman iptal edilebilir
- {{user_number}} kullanma — numarayı hastadan sesli al`,
      },
      tool_ids: ['tool_lookup_bookings', 'tool_cancel_booking'],
      edges: [
        {
          id: 'edge_cancel_to_closing',
          destination_node_id: 'node_closing',
          transition_condition: { type: 'prompt', prompt: 'Randevu başarıyla iptal edildi veya hasta iptalden vazgeçti.' },
        },
        {
          id: 'edge_cancel_to_intent',
          destination_node_id: 'node_intent_detection',
          transition_condition: { type: 'prompt', prompt: 'Hasta farklı bir konuya geçmek istiyor.' },
        },
      ],
    },

    // 5. RESCHEDULING
    {
      id: 'node_rescheduling',
      name: 'Randevu Değişikliği',
      type: 'conversation',
      instruction: {
        type: 'prompt',
        text: `Hastanın randevu değişikliği talebini yönet.

SIRA:
1. İsim ve telefon numarası al (zaten biliniyorsa tekrar sorma) — numarayı geri oku ve doğrulat
2. lookup_bookings ile mevcut randevuyu getir
3. Tek randevu varsa direkt onayla: "2 Nisan saat 15:00 randevunuzu değiştirmek istiyorsunuz, doğru mu?"
   Birden fazlaysa kısa özetle ve seçtir
4. Yeni tarih/saat öğren
5. check_availability ile kontrol et — slot'ları tek tek sayma, zaman aralığı olarak söyle
6. Onay al
7. ÖNCE create_booking ile yeni randevuyu oluştur
8. Başarılıysa cancel_booking ile eskiyi iptal et

KURALLAR:
- Önce yeni oluştur, sonra eski iptal et — yeni başarısız olursa eski korunur
- Slot yoksa alternatif öner veya mesaj almayı teklif et
- {{user_number}} kullanma`,
      },
      tool_ids: ['tool_lookup_bookings', 'tool_check_availability', 'tool_create_booking', 'tool_cancel_booking'],
      edges: [
        {
          id: 'edge_reschedule_to_closing',
          destination_node_id: 'node_closing',
          transition_condition: { type: 'prompt', prompt: 'Randevu başarıyla değiştirildi veya hasta vazgeçti.' },
        },
        {
          id: 'edge_reschedule_to_intent',
          destination_node_id: 'node_intent_detection',
          transition_condition: { type: 'prompt', prompt: 'Hasta farklı bir konuya geçmek istiyor.' },
        },
      ],
    },

    // 6. INQUIRY
    {
      id: 'node_inquiry',
      name: 'Bilgi Sorgusu',
      type: 'conversation',
      instruction: {
        type: 'prompt',
        text: `Hastanın sorularını Bilgi Bankası'ndan yanıtla.
Fiyat sorulursa: "Fiyatlarımız muayene sonrasında belirleniyor efendim"
Bilgi Bankası'nda yoksa: mesaj almayı teklif et.`,
      },
      knowledge_base_ids: [kbId],
      tool_ids: ['tool_get_business_hours'],
      edges: [
        {
          id: 'edge_inquiry_to_closing',
          destination_node_id: 'node_closing',
          transition_condition: { type: 'prompt', prompt: 'Hastanın sorusu yanıtlandı ve başka sorusu yok.' },
        },
        {
          id: 'edge_inquiry_to_booking',
          destination_node_id: 'node_booking',
          transition_condition: { type: 'prompt', prompt: 'Hasta bilgi aldıktan sonra randevu almak istiyor.' },
        },
        {
          id: 'edge_inquiry_to_intent',
          destination_node_id: 'node_intent_detection',
          transition_condition: { type: 'prompt', prompt: 'Hasta farklı bir konuya geçmek istiyor.' },
        },
      ],
    },

    // 7. MESSAGE TAKING
    {
      id: 'node_message_taking',
      name: 'Mesaj Alma',
      type: 'conversation',
      instruction: {
        type: 'prompt',
        text: `Arayanın mesajını al ve kaydet.

SIRA:
1. İsim al (zaten varsa tekrar sorma)
2. Telefon numarası al — geri oku ve doğrulat
3. Mesajı dinle
4. Özetle ve geri oku: "Mesajınızı tekrar edeyim: [özet]. Doğru mu?"
5. Onay gelince take_message tool'unu çağır (message_type: "message")

KURALLAR:
- take_message çağrılmadan kapanışa geçme
- {{user_number}} kullanma — numarayı hastadan sesli al`,
      },
      tool_ids: ['tool_take_message'],
      edges: [
        {
          id: 'edge_message_to_closing',
          destination_node_id: 'node_closing',
          transition_condition: { type: 'prompt', prompt: 'take_message tool başarıyla çağrıldı ve mesaj kaydedildi.' },
        },
        {
          id: 'edge_message_to_intent',
          destination_node_id: 'node_intent_detection',
          transition_condition: { type: 'prompt', prompt: 'Hasta başka bir konuya geçmek istiyor.' },
        },
      ],
    },

    // 8. URGENT ESCALATION
    {
      id: 'node_urgent_escalation',
      name: 'Acil Durum',
      type: 'conversation',
      instruction: {
        type: 'prompt',
        text: `Acil durum — hızlı ve sakin yönet.

SIRA:
1. Sakinleştir: "Merak etmeyin efendim, doktorumuza hemen bilgi vereyim"
2. İsim ve telefon al — numarayı geri oku ve doğrulat
3. Belirtileri hastanın söylediği şekilde not al (ek soru sorma, doktor değilsin)
4. take_message tool'unu çağır (message_type: "urgent")
5. "Doktorumuza ilettim, en kısa sürede dönüş yapacak. Telefonunuzu açık tutun."

KURALLAR:
- take_message çağrılmadan kapanışa geçme
- Tıbbi tavsiye verme
- 112 yönlendirmesi sadece hayati tehlike: nefes alamıyor, bilinç kaybı
- {{user_number}} kullanma`,
      },
      tool_ids: ['tool_take_message', 'tool_get_emergency_info'],
      edges: [
        {
          id: 'edge_urgent_to_closing',
          destination_node_id: 'node_closing',
          transition_condition: { type: 'prompt', prompt: 'take_message tool başarıyla çağrıldı ve acil durum kaydedildi.' },
        },
      ],
    },

    // 9. CALLBACK / FOLLOW-UP
    {
      id: 'node_callback_followup',
      name: 'Geri Arama Takibi',
      type: 'conversation',
      instruction: {
        type: 'prompt',
        text: `Geri arama talebi yönet.

SIRA:
1. İsim ve telefon al — numarayı geri oku ve doğrulat
2. Hangi konuda geri arama beklendiğini kısa öğren
3. take_message tool'unu çağır (message_type: "callback")
4. "Talebinizi not aldım, en kısa sürede dönüş yapılacak"

KURALLAR:
- take_message çağrılmadan kapanışa geçme
- Kayıtlarda not bulunamazsa: "Dilerseniz tekrar bir geri arama talebi oluşturayım"
- {{user_number}} kullanma`,
      },
      tool_ids: ['tool_get_caller_memory', 'tool_take_message'],
      edges: [
        {
          id: 'edge_callback_to_closing',
          destination_node_id: 'node_closing',
          transition_condition: { type: 'prompt', prompt: 'take_message tool başarıyla çağrıldı ve geri arama talebi kaydedildi.' },
        },
        {
          id: 'edge_callback_to_intent',
          destination_node_id: 'node_intent_detection',
          transition_condition: { type: 'prompt', prompt: 'Hasta farklı bir konuya geçmek istiyor.' },
        },
      ],
    },

    // 10. CLOSING
    {
      id: 'node_closing',
      name: 'Kapanış',
      type: 'conversation',
      instruction: {
        type: 'prompt',
        text: `Görüşmeyi nazikçe kapat.

"Başka yardımcı olabileceğim bir konu var mı efendim?"
- Evet → intent_detection'a yönlendir
- Hayır → "İyi günler dilerim efendim, sağlıklı günler." de ve CÜMLE BİTTİKTEN SONRA end_call çağır. end_call'ın execution_message'ını boş bırak.`,
      },
      tools: [
        {
          type: 'end_call',
          name: 'end_call',
          description: 'Görüşmeyi sonlandır. Hasta başka bir isteği olmadığını belirttiğinde çağır.',
        },
      ],
      edges: [
        {
          id: 'edge_closing_to_intent',
          destination_node_id: 'node_intent_detection',
          transition_condition: { type: 'prompt', prompt: 'Hasta başka bir konuda yardım istiyor.' },
        },
      ],
    },
  ];

  const flow = await client.conversationFlow.create({
    start_speaker: 'agent',
    start_node_id: 'node_greeting',
    model_choice: { model: 'gpt-4.1', type: 'cascading' },
    model_temperature: 0,
    global_prompt: GLOBAL_PROMPT,
    knowledge_base_ids: [kbId],
    tool_call_strict_mode: true,
    nodes,
    tools,
  });

  log('FLOW', `Created: ${flow.conversation_flow_id}`, {
    conversation_flow_id: flow.conversation_flow_id,
    version: flow.version,
    node_count: flow.nodes?.length,
  });
  return flow.conversation_flow_id;
}

// ─── 3) List Voices ───
async function listVoices() {
  log('VOICES', 'Listing all available voices...');
  const voices = await client.voice.list();

  const femaleVoices = voices.filter((v) => v.gender === 'female');

  console.log(`\nToplam ses: ${voices.length} | Kadın ses: ${femaleVoices.length}\n`);
  console.log('─── Kadın Sesler ───');
  femaleVoices.forEach((v, i) => {
    console.log(`  ${i + 1}. ${v.voice_name} | ID: ${v.voice_id} | Provider: ${v.provider}${v.accent ? ` | Accent: ${v.accent}` : ''}${v.preview_audio_url ? ` | Preview: ${v.preview_audio_url}` : ''}`);
  });

  console.log('\n─── Erkek Sesler ───');
  const maleVoices = voices.filter((v) => v.gender === 'male');
  maleVoices.forEach((v, i) => {
    console.log(`  ${i + 1}. ${v.voice_name} | ID: ${v.voice_id} | Provider: ${v.provider}${v.accent ? ` | Accent: ${v.accent}` : ''}${v.preview_audio_url ? ` | Preview: ${v.preview_audio_url}` : ''}`);
  });
}

// ─── Main ───
async function main() {
  console.log('╔══════════════════════════════════════════════════╗');
  console.log('║  Tekten Klinik — Retell AI Setup (Aşama 1)     ║');
  console.log('╚══════════════════════════════════════════════════╝');

  try {
    const kbId = await createKnowledgeBase();
    const flowId = await createConversationFlow(kbId);
    await listVoices();

    console.log('\n╔══════════════════════════════════════════════════╗');
    console.log('║            AŞAMA 1 TAMAMLANDI                   ║');
    console.log('╠══════════════════════════════════════════════════╣');
    console.log(`║  KB ID:   ${kbId}`);
    console.log(`║  Flow ID: ${flowId}`);
    console.log('╠══════════════════════════════════════════════════╣');
    console.log('║  Yukarıdaki ses listesinden birini seçin.       ║');
    console.log('║  Aşama 2 için: create-agent.mjs çalıştırılacak  ║');
    console.log('╚══════════════════════════════════════════════════╝');
  } catch (err) {
    console.error('\nSETUP FAILED');
    console.error('Error:', err.message);
    if (err.status) console.error('HTTP Status:', err.status);
    if (err.error) console.error('Error body:', JSON.stringify(err.error, null, 2));
    console.error('\nFull error:', err);
    process.exit(1);
  }
}

main();
