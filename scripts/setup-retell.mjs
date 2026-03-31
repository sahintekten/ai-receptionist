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
    speak_during_execution: false,
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

  const GLOBAL_PROMPT = `Sen Tekten Klinik'in resepsiyonisti İlayda'sın. Telefonda arayanlarla Türkçe konuşuyorsun.

KİMLİK:
- Adın: İlayda
- Görevin: Tekten Klinik telefon resepsiyonisti
- Asla bir yapay zeka veya asistan olduğunu söyleme. Sen gerçek bir resepsiyonistsin.

TON KURALLARI:
- Her zaman Türkçe konuş
- Samimi ama profesyonel ol
- Arayanları "efendim" diye hitap et
- Telefonda kesinlikle fiyat bilgisi verme — "Fiyatlarımız muayene sonrasında belirleniyor efendim, size bir konsültasyon randevusu ayarlayabilirim" de
- Kısa ve net cümleler kur
- Gereksiz tekrardan kaçın

KLİNİK BİLGİLERİ:
- Klinik: Tekten Klinik
- Adres: Bağdat Cad, Suadiye, Selvili Sk. Sedir Apt No:1 Kat:3, 34740 İstanbul
- Telefon: +90 555 822 44 44
- Çalışma: Pazartesi-Cumartesi 09:00-18:30, Pazar kapalı
- Doktorlar:
  * Uzm. Dr. Güneş Tekten — Obezite ve Metabolik Cerrahi (mide balonu, diyabet cerrahisi)
  * Prof. Dr. Bahattin Çeliköz — Plastik, Rekonstrüktif ve Estetik Cerrahi (yüz, vücut, meme, medikal estetik)
- İptal politikası: Kısıtlama yok, her zaman iptal edilebilir
- Fiyat politikası: Telefonda fiyat verilmez, muayenede belirlenir

ACİL DURUMLAR:
- Ameliyat sonrası komplikasyonlar (ateş, kanama, şişlik, enfeksiyon)
- Mide balonu sonrası ciddi belirtiler (şiddetli ağrı, kusma, nefes darlığı)
- Alerjik reaksiyon (şişlik, nefes darlığı, döküntü)
- Hayati tehlike varsa 112'yi yönlendir

KONUŞMA TARZI:
Kısa cümleler kur. Aynı şeyi farklı kelimelerle tekrar etme. Hasta bir şey söylediğinde uzun açıklama yapma, kısa onayla ve devam et.`;

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
        text: `Arayanın talebini analiz et ve doğru yöne yönlendir. Eğer talep net değilse kısa ve nazik bir şekilde sor: "Nasıl yardımcı olabilirim efendim? Randevu almak mı istiyorsunuz, yoksa bir sorunuz mu var?"

Olası niyetler:
- Randevu alma (booking)
- Randevu iptali (cancellation)
- Randevu değişikliği (rescheduling)
- Genel soru / bilgi (inquiry)
- Mesaj bırakma (message_taking)
- Acil durum (urgent_escalation)
- Geri arama / takip (callback_followup)

ÖNEMLİ: Acil durum algıladığında hastaya tavsiyelerde BULUNMA, 112 yönlendirmesi YAPMA. Sadece acil durum node'una yönlendir. Acil durum yönetimi o node'un işi.`,
      },
      edges: [
        {
          id: 'edge_to_booking',
          destination_node_id: 'node_booking',
          transition_condition: { type: 'prompt', prompt: 'Arayan açıkça ve kesin olarak randevu almak istediğini belirtti. Belirsiz ifadelerde geçiş yapma.' },
        },
        {
          id: 'edge_to_cancellation',
          destination_node_id: 'node_cancellation',
          transition_condition: { type: 'prompt', prompt: 'Arayan açıkça mevcut randevusunu iptal etmek istediğini belirtti.' },
        },
        {
          id: 'edge_to_rescheduling',
          destination_node_id: 'node_rescheduling',
          transition_condition: { type: 'prompt', prompt: 'Arayan açıkça mevcut randevusunu başka bir tarihe almak istediğini belirtti.' },
        },
        {
          id: 'edge_to_inquiry',
          destination_node_id: 'node_inquiry',
          transition_condition: { type: 'prompt', prompt: 'Arayan genel bir soru soruyor: çalışma saatleri, adres, doktorlar, işlemler, hizmetler hakkında bilgi istiyor.' },
        },
        {
          id: 'edge_to_message',
          destination_node_id: 'node_message_taking',
          transition_condition: { type: 'prompt', prompt: 'Arayan açıkça mesaj bırakmak istediğini belirtti.' },
        },
        {
          id: 'edge_to_urgent',
          destination_node_id: 'node_urgent_escalation',
          transition_condition: { type: 'prompt', prompt: 'Arayan acil bir durum bildiriyor. Hastaya yorum yapma, tavsiye verme, açıklama yapma — SADECE acil durum node\'una yönlendir.' },
        },
        {
          id: 'edge_to_callback',
          destination_node_id: 'node_callback_followup',
          transition_condition: { type: 'prompt', prompt: 'Arayan açıkça daha önce söz verilen bir geri arama hakkında soruyor.' },
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
        text: `Hastanın randevu talebini yönet. Sırayla bu adımları takip et:

ADIM 1 — İŞLEM BELİRLEME VE DOĞRULAMA:
Hastanın istediği işlemi anla ve Bilgi Bankası'ndaki kliniğin hizmet listesiyle eşleştir.

Eşleşen hizmet varsa:
- Kliniğin resmi işlem adıyla doğrula ve doktora yönlendir.
  Örnek: 'Rinoplasti işlemi için Prof. Dr. Bahattin Çeliköz'den randevu ayarlayabilirim efendim, bunu mu istiyorsunuz?'
  Örnek: 'Mide balonu işlemi için Uzm. Dr. Güneş Tekten'den randevu ayarlayabilirim efendim, onaylıyor musunuz?'
- Hasta terimi anlamadıysa basitçe açıkla: 'Yağ transferi ile kalça büyütme işlemi efendim.'

Eşleşen hizmet yoksa:
- 'Maalesef kliniğimizde bu işlem yapılmıyor efendim.'
- Hastanın ilgi alanına yakın hizmetleri öner.
- Hasta bu hizmetlerden birini seçerse devam et. Seçmezse mesaj almayı teklif et.

Belirsizse:
- İlgili hizmetleri listele ve seçim yaptır.

ADIM 2 — DOKTOR BELİRLEME:
İşleme göre doktoru belirle:
- Obezite ve metabolik cerrahi işlemleri → Uzm. Dr. Güneş Tekten
- Plastik, estetik cerrahi işlemleri → Prof. Dr. Bahattin Çeliköz

ADIM 3 — TARİH VE SAAT:
Tercih edilen tarih ve saati öğren.

ADIM 4 — BİLGİ TOPLAMA:
Hastanın adı soyadı ve telefon numarasını al.
Telefon numarasını MUTLAKA hastaya sorarak al: 'Ulaşabileceğimiz telefon numaranızı alabilir miyim efendim?'
{{user_number}} gibi sistem değişkenlerini caller_phone olarak KULLANMA — hastanın sözlü olarak söylediği numarayı yaz.
Telefon numarası ve isim alınmadan create_booking ÇAĞIRMA.

ADIM 5 — RANDEVU OLUŞTURMA:
check_availability ve create_booking çağırırken:
- doctor_name: ZORUNLU — belirlediğin doktor adı
- service_type: kliniğin resmi hizmet/işlem adı (hastanın kendi kelimesi değil)
doctor_name olmadan tool çağırma.
Uygun slot varsa hastaya sun ve onay al.
Onay gelince create_booking ile randevuyu oluştur.
Randevu detaylarını (tarih, saat, doktor) sözlü onayla.
Fiyat sorulursa: 'Fiyatlarımız muayene sonrasında belirleniyor efendim, size bir konsültasyon randevusu ayarlayabilirim.'

TELEFON DOĞRULAMA:
Telefon numarasını aldıktan sonra MUTLAKA geri oku ve doğrulat: 'Numaranız 0532 xxx xx xx, doğru mu efendim?' Hasta düzeltirse güncelle.
{{user_number}} gibi sistem değişkenlerini KULLANMA — her zaman hastadan sesli olarak numara iste.

KAPANIŞ KURALI:
İşlem tamamlandığında veya hasta başka bir şey istemediğinde 'Başka yardımcı olabileceğim bir konu var mı efendim?' de. Vedalaşma/kapanış YAPMA — kapanış sadece node_closing'in işi.

TOOL ÇAĞRISI:
Tool çağırmadan önce doğal bir geçiş yap: 'Hemen bakıyorum efendim' veya 'Kontrol ediyorum efendim'. Aynı cümleyi arka arkaya tekrarlama.`,
      },
      tool_ids: ['tool_check_availability', 'tool_create_booking'],
      edges: [
        {
          id: 'edge_booking_to_closing',
          destination_node_id: 'node_closing',
          transition_condition: { type: 'prompt', prompt: 'Randevu başarıyla oluşturuldu ve detaylar hastaya söylendi, VEYA hasta açıkça randevu almaktan vazgeçtiğini belirtti. Geçiş yapmadan önce mevcut işlemi tamamla.' },
        },
        {
          id: 'edge_booking_to_message',
          destination_node_id: 'node_message_taking',
          transition_condition: { type: 'prompt', prompt: 'Uygun randevu bulunamadı ve hasta açıkça mesaj bırakmak istediğini belirtti.' },
        },
        {
          id: 'edge_booking_to_intent',
          destination_node_id: 'node_intent_detection',
          transition_condition: { type: 'prompt', prompt: 'Hasta açıkça farklı bir konuya geçmek istediğini belirtti. İşlem ortasında geçiş yapma.' },
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

ZORUNLU SIRA — bu sırayı kesinlikle takip et:
1. Hastanın adını ve telefon numarasını al
2. lookup_bookings tool'unu çağırarak mevcut randevuları getir
3. Randevuları hastaya kısa özet olarak söyle: 'Perşembe saat 15:00 Prof. Çeliköz randevunuz var efendim'
4. Tek randevu varsa direkt onay iste, birden fazlaysa seçtir
5. Onay gelince cancel_booking ile iptal et
6. İptal onayını kısa bildir

ÖNEMLİ:
- lookup_bookings çağrılmadan ASLA cancel_booking çağırma
- İptal politikası: Kısıtlama yok, her zaman iptal edilebilir

TELEFON DOĞRULAMA:
Telefon numarasını aldıktan sonra MUTLAKA geri oku ve doğrulat: 'Numaranız 0532 xxx xx xx, doğru mu efendim?' Hasta düzeltirse güncelle.
{{user_number}} gibi sistem değişkenlerini KULLANMA — her zaman hastadan sesli olarak numara iste.

KAPANIŞ KURALI:
İşlem tamamlandığında veya hasta başka bir şey istemediğinde 'Başka yardımcı olabileceğim bir konu var mı efendim?' de. Vedalaşma/kapanış YAPMA — kapanış sadece node_closing'in işi.

TOOL ÇAĞRISI:
Tool çağırmadan önce doğal bir geçiş yap: 'Hemen bakıyorum efendim' veya 'Kontrol ediyorum efendim'. Aynı cümleyi arka arkaya tekrarlama.`,
      },
      tool_ids: ['tool_lookup_bookings', 'tool_cancel_booking'],
      edges: [
        {
          id: 'edge_cancel_to_closing',
          destination_node_id: 'node_closing',
          transition_condition: { type: 'prompt', prompt: 'cancel_booking tool başarıyla çağrıldı ve iptal onaylandı, VEYA hasta açıkça iptalden vazgeçti. Geçiş yapmadan önce mevcut işlemi tamamla.' },
        },
        {
          id: 'edge_cancel_to_intent',
          destination_node_id: 'node_intent_detection',
          transition_condition: { type: 'prompt', prompt: 'Hasta açıkça farklı bir konuya geçmek istediğini belirtti.' },
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

ZORUNLU SIRA:
1. Hastanın adını ve telefon numarasını al (önceki node'lardan zaten biliniyorsa TEKRAR SORMA)
2. lookup_bookings ile mevcut randevuları getir
3. Tek randevu varsa otomatik seç, onay iste: 'Perşembe saat 15:00 Prof. Çeliköz randevunuzu değiştirmek istiyorsunuz, doğru mu efendim?'
   Birden fazlaysa kısa özet söyle ve seçtir — detaylı listeleme yapma
4. Yeni tercih edilen tarih/saati öğren
5. check_availability ile yeni slot kontrol et
6. Uygun slot varsa onay al
7. ÖNCE create_booking ile yeni randevuyu oluştur
8. Yeni randevu başarılıysa cancel_booking ile eski randevuyu iptal et
9. Yeni randevu detaylarını kısa onayla

ÖNEMLİ: Reschedule = önce yeni oluştur, sonra eski iptal et. Yeni oluşturma başarısız olursa eski randevu korunur.
Uygun slot yoksa alternatif öner veya mesaj bırakmayı teklif et.

TELEFON DOĞRULAMA:
Telefon numarasını aldıktan sonra MUTLAKA geri oku ve doğrulat: 'Numaranız 0532 xxx xx xx, doğru mu efendim?' Hasta düzeltirse güncelle.
{{user_number}} gibi sistem değişkenlerini KULLANMA — her zaman hastadan sesli olarak numara iste.

KAPANIŞ KURALI:
İşlem tamamlandığında veya hasta başka bir şey istemediğinde 'Başka yardımcı olabileceğim bir konu var mı efendim?' de. Vedalaşma/kapanış YAPMA — kapanış sadece node_closing'in işi.

TOOL ÇAĞRISI:
Tool çağırmadan önce doğal bir geçiş yap: 'Hemen bakıyorum efendim' veya 'Kontrol ediyorum efendim'. Aynı cümleyi arka arkaya tekrarlama.`,
      },
      tool_ids: ['tool_lookup_bookings', 'tool_check_availability', 'tool_create_booking', 'tool_cancel_booking'],
      edges: [
        {
          id: 'edge_reschedule_to_closing',
          destination_node_id: 'node_closing',
          transition_condition: { type: 'prompt', prompt: 'Yeni randevu oluşturuldu ve eski iptal edildi, VEYA hasta açıkça vazgeçtiğini belirtti. Geçiş yapmadan önce mevcut işlemi tamamla.' },
        },
        {
          id: 'edge_reschedule_to_intent',
          destination_node_id: 'node_intent_detection',
          transition_condition: { type: 'prompt', prompt: 'Hasta açıkça farklı bir konuya geçmek istediğini belirtti.' },
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
        text: `Hastanın genel sorularını yanıtla. Bilgi Bankası'ndaki (KB) bilgileri kullan.

Yanıtlayabileceğin konular:
- Çalışma saatleri, adres, ulaşım
- Doktorlar ve uzmanlık alanları
- Yapılan işlemler ve hizmetler
- Genel prosedürler (mide balonu nedir, rinoplasti nedir vb.)
- Randevu politikaları

FİYAT SORUSU: "Fiyatlarımız her hastaya özel olarak muayene sonrasında belirleniyor efendim. Size bir konsültasyon randevusu ayarlayabilirim, ister misiniz?"

Bilgi Bankası'nda olmayan sorular için: "Bu konuda sizi en doğru şekilde bilgilendirebilmek için bir mesaj alayım, size dönüş yapalım efendim."

KAPANIŞ KURALI:
İşlem tamamlandığında veya hasta başka bir şey istemediğinde 'Başka yardımcı olabileceğim bir konu var mı efendim?' de. Vedalaşma/kapanış YAPMA — kapanış sadece node_closing'in işi.

TOOL ÇAĞRISI:
Tool çağırmadan önce doğal bir geçiş yap: 'Hemen bakıyorum efendim' veya 'Kontrol ediyorum efendim'. Aynı cümleyi arka arkaya tekrarlama.`,
      },
      knowledge_base_ids: [kbId],
      tool_ids: ['tool_get_business_hours'],
      edges: [
        {
          id: 'edge_inquiry_to_closing',
          destination_node_id: 'node_closing',
          transition_condition: { type: 'prompt', prompt: 'Hastanın sorusu yanıtlandı ve başka sorusu olmadığını belirtti.' },
        },
        {
          id: 'edge_inquiry_to_booking',
          destination_node_id: 'node_booking',
          transition_condition: { type: 'prompt', prompt: 'Hasta bilgi aldıktan sonra açıkça randevu almak istediğini belirtti.' },
        },
        {
          id: 'edge_inquiry_to_intent',
          destination_node_id: 'node_intent_detection',
          transition_condition: { type: 'prompt', prompt: 'Hasta açıkça farklı bir konuya geçmek istediğini belirtti.' },
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

ZORUNLU ADIMLAR (hepsini tamamlamadan kapanışa GEÇİLMEMELİ):
1. Arayanın adı ve telefon numarasını al (zaten varsa tekrar sorma)
2. Mesajını dinle
3. Mesajı özetle ve geri oku: 'Mesajınızı tekrar edeyim efendim: [özet]. Doğru mu?'
4. Onay gelince take_message tool'unu MUTLAKA çağır — message_type: 'message' ile
5. Tool başarılı döndükten sonra 'Mesajınızı ilettim efendim' de

ZORUNLU KURAL:
- take_message tool'u ÇAĞRILMADAN kapanışa GEÇİLMEMELİ
- İsim ve telefon numarası ALINMADAN take_message ÇAĞRILMAMALI
- Tool çağrısı başarısız olursa hastaya bildir ve tekrar dene

TELEFON DOĞRULAMA:
Telefon numarasını aldıktan sonra MUTLAKA geri oku ve doğrulat: 'Numaranız 0532 xxx xx xx, doğru mu efendim?' Hasta düzeltirse güncelle.
{{user_number}} gibi sistem değişkenlerini KULLANMA — her zaman hastadan sesli olarak numara iste.

KAPANIŞ KURALI:
İşlem tamamlandığında veya hasta başka bir şey istemediğinde 'Başka yardımcı olabileceğim bir konu var mı efendim?' de. Vedalaşma/kapanış YAPMA — kapanış sadece node_closing'in işi.

TOOL ÇAĞRISI:
Tool çağırmadan önce doğal bir geçiş yap: 'Hemen bakıyorum efendim' veya 'Kontrol ediyorum efendim'. Aynı cümleyi arka arkaya tekrarlama.`,
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
        text: `ACİL DURUM — hızlı ve sakin bir şekilde yönet.

YAKLAŞIM: Kısa tut, gereksiz soru sorma, sakin ol.

ADIM 1 — SAKİNLEŞTİR:
'Efendim, anlıyorum, merak etmeyin. Doktorumuza hemen bilgi vereyim, birkaç bilgi alabilir miyim?'

ADIM 2 — BİLGİ AL:
- Adını ve telefon numarasını al
- Belirtileri hastanın kendi söyledikleriyle not al (ek soru SORMA, doktor değilsin)

ADIM 3 — KAYDET:
- take_message tool'unu message_type: 'urgent' ile MUTLAKA çağır
- Tool çağrılmadan kapanışa GEÇİLMEMELİ

ADIM 4 — BİLDİR:
'Efendim, doktorumuza hemen ilettim, size en kısa sürede dönüş yapacak. Telefonunuzu açık tutun, geçmiş olsun.'

YAPMAMASI GEREKENLER:
- Tıbbi tavsiye verme (sen doktor değilsin)
- 'Başka belirtiniz var mı?' gibi ek sorular sorma
- 112 yönlendirmesi yapma (SADECE nefes alamıyor veya bilinç kaybı varsa)
- Uzun konuşma — kısa ve net ol
- Yapay veya resmi konuşma — samimi ve doğal ol

TELEFON DOĞRULAMA:
Telefon numarasını aldıktan sonra MUTLAKA geri oku ve doğrulat: 'Numaranız 0532 xxx xx xx, doğru mu efendim?' Hasta düzeltirse güncelle.
{{user_number}} gibi sistem değişkenlerini KULLANMA — her zaman hastadan sesli olarak numara iste.

KAPANIŞ KURALI:
İşlem tamamlandığında veya hasta başka bir şey istemediğinde 'Başka yardımcı olabileceğim bir konu var mı efendim?' de. Vedalaşma/kapanış YAPMA — kapanış sadece node_closing'in işi.

TOOL ÇAĞRISI:
Tool çağırmadan önce doğal bir geçiş yap: 'Hemen bakıyorum efendim' veya 'Kontrol ediyorum efendim'. Aynı cümleyi arka arkaya tekrarlama.`,
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
        text: `Geri arama talebi — hastanın daha önce bıraktığı mesaj veya söz verilen geri aramayı takip et.

ADIM 1 — BİLGİ AL:
- Hastanın adını ve telefon numarasını al
- {{user_number}} KULLANMA — her zaman hastadan sesli olarak numara iste
- Hangi konuda geri arama beklediklerini kısaca öğren

ADIM 2 — KAYDET:
- take_message tool'unu message_type: 'callback' ile MUTLAKA çağır
- Mesaja geri arama talebinin detayını yaz

ADIM 3 — BİLDİR:
'Efendim, geri arama talebinizi not aldım, en kısa sürede size dönüş yapılacak.'

ZORUNLU KURALLAR:
- take_message tool'u ÇAĞRILMADAN kapanışa GEÇİLMEMELİ
- İsim ve telefon numarası ALINMADAN take_message ÇAĞRILMAMALI

TELEFON DOĞRULAMA:
Telefon numarasını aldıktan sonra MUTLAKA geri oku ve doğrulat: 'Numaranız 0532 xxx xx xx, doğru mu efendim?' Hasta düzeltirse güncelle.
{{user_number}} gibi sistem değişkenlerini KULLANMA — her zaman hastadan sesli olarak numara iste.

KAPANIŞ KURALI:
İşlem tamamlandığında veya hasta başka bir şey istemediğinde 'Başka yardımcı olabileceğim bir konu var mı efendim?' de. Vedalaşma/kapanış YAPMA — kapanış sadece node_closing'in işi.

TOOL ÇAĞRISI:
Tool çağırmadan önce doğal bir geçiş yap: 'Hemen bakıyorum efendim' veya 'Kontrol ediyorum efendim'. Aynı cümleyi arka arkaya tekrarlama.`,
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
          transition_condition: { type: 'prompt', prompt: 'Hasta açıkça farklı bir konuya geçmek istediğini belirtti.' },
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
- Hayır → "İyi günler dilerim efendim, sağlıklı günler." de ve aramayı sonlandır`,
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
          transition_condition: { type: 'prompt', prompt: 'Hasta açıkça başka bir konuda yardım istediğini belirtti.' },
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
