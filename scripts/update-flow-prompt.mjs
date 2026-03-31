import 'dotenv/config';
import Retell from 'retell-sdk';

const client = new Retell({ apiKey: process.env.RETELL_API_KEY });
const FLOW_ID = 'conversation_flow_710161ccad8e';

// ─── Shared prompt fragments ───

const NO_CLOSING_RULE = `

KAPANIŞ KURALI:
İşlem tamamlandığında veya hasta başka bir şey istemediğinde 'Başka yardımcı olabileceğim bir konu var mı efendim?' de. Vedalaşma/kapanış YAPMA — kapanış sadece node_closing'in işi.`;

const PHONE_VERIFY_RULE = `

TELEFON DOĞRULAMA:
Telefon numarasını aldıktan sonra MUTLAKA geri oku ve doğrulat: 'Numaranız 0532 xxx xx xx, doğru mu efendim?' Hasta düzeltirse güncelle.
{{user_number}} gibi sistem değişkenlerini KULLANMA — her zaman hastadan sesli olarak numara iste.`;

const FILLER_RULE = `

TOOL ÇAĞRISI:
Tool çağırmadan önce doğal bir geçiş yap: 'Hemen bakıyorum efendim' veya 'Kontrol ediyorum efendim'. Aynı cümleyi arka arkaya tekrarlama.`;

// ─── Node prompts ───

const PROMPTS = {
  node_booking: `Hastanın randevu talebini yönet. Sırayla bu adımları takip et:

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
Telefon numarası ve isim alınmadan create_booking ÇAĞIRMA.

ADIM 5 — RANDEVU OLUŞTURMA:
check_availability ve create_booking çağırırken:
- doctor_name: ZORUNLU — belirlediğin doktor adı
- service_type: kliniğin resmi hizmet/işlem adı (hastanın kendi kelimesi değil)
doctor_name olmadan tool çağırma.
Uygun slot varsa hastaya sun ve onay al.
Onay gelince create_booking ile randevuyu oluştur.
Randevu detaylarını (tarih, saat, doktor) sözlü onayla.
Fiyat sorulursa: 'Fiyatlarımız muayene sonrasında belirleniyor efendim, size bir konsültasyon randevusu ayarlayabilirim.'`,

  node_cancellation: `Hastanın randevu iptal talebini yönet.

ZORUNLU SIRA — bu sırayı kesinlikle takip et:
1. Hastanın adını ve telefon numarasını al
2. lookup_bookings tool'unu çağırarak mevcut randevuları getir
3. Randevuları hastaya kısa özet olarak söyle: 'Perşembe saat 15:00 Prof. Çeliköz randevunuz var efendim'
4. Tek randevu varsa direkt onay iste, birden fazlaysa seçtir
5. Onay gelince cancel_booking ile iptal et
6. İptal onayını kısa bildir

ÖNEMLİ:
- lookup_bookings çağrılmadan ASLA cancel_booking çağırma
- İptal politikası: Kısıtlama yok, her zaman iptal edilebilir`,

  node_rescheduling: `Hastanın randevu değişikliği talebini yönet.

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
Uygun slot yoksa alternatif öner veya mesaj bırakmayı teklif et.`,

  node_message_taking: `Arayanın mesajını al ve kaydet.

ZORUNLU ADIMLAR (hepsini tamamlamadan kapanışa GEÇİLMEMELİ):
1. Arayanın adı ve telefon numarasını al (zaten varsa tekrar sorma)
2. Mesajını dinle
3. Mesajı özetle ve geri oku: 'Mesajınızı tekrar edeyim efendim: [özet]. Doğru mu?'
4. Onay gelince take_message tool'unu MUTLAKA çağır — message_type: 'message' ile
5. Tool başarılı döndükten sonra 'Mesajınızı ilettim efendim' de

ZORUNLU KURAL:
- take_message tool'u ÇAĞRILMADAN kapanışa GEÇİLMEMELİ
- İsim ve telefon numarası ALINMADAN take_message ÇAĞRILMAMALI
- Tool çağrısı başarısız olursa hastaya bildir ve tekrar dene`,

  node_urgent_escalation: `ACİL DURUM — hızlı ve sakin bir şekilde yönet.

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
- Yapay veya resmi konuşma — samimi ve doğal ol`,

  node_callback_followup: `Geri arama talebi — hastanın daha önce bıraktığı mesaj veya söz verilen geri aramayı takip et.

ADIM 1 — BİLGİ AL:
- Hastanın adını ve telefon numarasını al
- Hangi konuda geri arama beklediklerini kısaca öğren

ADIM 2 — KAYDET:
- take_message tool'unu message_type: 'callback' ile MUTLAKA çağır
- Mesaja geri arama talebinin detayını yaz

ADIM 3 — BİLDİR:
'Efendim, geri arama talebinizi not aldım, en kısa sürede size dönüş yapılacak.'

ZORUNLU KURALLAR:
- take_message tool'u ÇAĞRILMADAN kapanışa GEÇİLMEMELİ
- İsim ve telefon numarası ALINMADAN take_message ÇAĞRILMAMALI`,
};

// ─── Edge transitions (FIX B — precise conditions) ───

const EDGE_UPDATES = {
  // Intent detection edges
  edge_to_booking: 'Arayan açıkça ve kesin olarak randevu almak istediğini belirtti. Belirsiz ifadelerde geçiş yapma.',
  edge_to_cancellation: 'Arayan açıkça mevcut randevusunu iptal etmek istediğini belirtti.',
  edge_to_rescheduling: 'Arayan açıkça mevcut randevusunu başka bir tarihe almak istediğini belirtti.',
  edge_to_inquiry: 'Arayan genel bir soru soruyor: çalışma saatleri, adres, doktorlar, işlemler hakkında bilgi istiyor.',
  edge_to_message: 'Arayan açıkça mesaj bırakmak istediğini belirtti.',
  edge_to_urgent: 'Arayan acil bir durum bildiriyor. Hastaya yorum yapma, tavsiye verme — SADECE acil durum node\'una yönlendir.',
  edge_to_callback: 'Arayan açıkça daha önce söz verilen bir geri arama hakkında soruyor.',
  // Booking edges
  edge_booking_to_closing: 'Randevu başarıyla oluşturuldu ve detaylar hastaya söylendi, VEYA hasta açıkça randevu almaktan vazgeçtiğini belirtti. Geçiş yapmadan önce mevcut işlemi tamamla.',
  edge_booking_to_message: 'Uygun randevu bulunamadı ve hasta açıkça mesaj bırakmak istediğini belirtti.',
  edge_booking_to_intent: 'Hasta açıkça farklı bir konuya geçmek istediğini belirtti. İşlem ortasında geçiş yapma.',
  // Cancel edges
  edge_cancel_to_closing: 'cancel_booking tool başarıyla çağrıldı ve iptal onaylandı, VEYA hasta açıkça iptalden vazgeçti. Geçiş yapmadan önce mevcut işlemi tamamla.',
  edge_cancel_to_intent: 'Hasta açıkça farklı bir konuya geçmek istediğini belirtti.',
  // Reschedule edges
  edge_reschedule_to_closing: 'Yeni randevu oluşturuldu ve eski iptal edildi, VEYA hasta açıkça vazgeçtiğini belirtti. Geçiş yapmadan önce mevcut işlemi tamamla.',
  edge_reschedule_to_intent: 'Hasta açıkça farklı bir konuya geçmek istediğini belirtti.',
  // Inquiry edges
  edge_inquiry_to_closing: 'Hastanın sorusu yanıtlandı ve başka sorusu olmadığını belirtti.',
  edge_inquiry_to_booking: 'Hasta bilgi aldıktan sonra açıkça randevu almak istediğini belirtti.',
  edge_inquiry_to_intent: 'Hasta açıkça farklı bir konuya geçmek istediğini belirtti.',
  // Message edges
  edge_message_to_closing: 'take_message tool başarıyla çağrıldı ve mesaj kaydedildi. Geçiş yapmadan önce tool çağrısını tamamla.',
  edge_message_to_intent: 'Hasta açıkça başka bir konuya geçmek istediğini belirtti.',
  // Urgent edge
  edge_urgent_to_closing: 'take_message tool başarıyla çağrıldı ve acil durum kaydedildi. Geçiş yapmadan önce tool çağrısını tamamla.',
  // Callback edges
  edge_callback_to_closing: 'take_message tool başarıyla çağrıldı ve geri arama talebi kaydedildi. Geçiş yapmadan önce tool çağrısını tamamla.',
  edge_callback_to_intent: 'Hasta açıkça farklı bir konuya geçmek istediğini belirtti.',
  // Closing edge
  edge_closing_to_intent: 'Hasta açıkça başka bir konuda yardım istediğini belirtti.',
  // Greeting edge
  edge_greeting_to_intent: 'Arayan bir yanıt verdiğinde veya talebini belirttiğinde.',
};

// Nodes that collect phone numbers get both PHONE_VERIFY_RULE and NO_CLOSING_RULE
const PHONE_NODES = ['node_booking', 'node_cancellation', 'node_rescheduling', 'node_message_taking', 'node_urgent_escalation', 'node_callback_followup'];
// All action nodes get NO_CLOSING_RULE
const ACTION_NODES = [...PHONE_NODES, 'node_inquiry'];

async function main() {
  const flow = await client.conversationFlow.retrieve(FLOW_ID);

  // ─── 1. Update global prompt (FIX F — naturalness) ───
  const dateBlock = `TARİH VE SAAT BİLGİSİ:
- Şu anki tarih ve saat: {{current_time_Europe/Istanbul}}
- 14 günlük takvim: {{current_calendar_Europe/Istanbul}}
- Arayanın numarası: {{user_number}}
- Çağrı yönü: {{direction}}

`;

  const naturalBlock = `

KONUŞMA TARZI:
Kısa cümleler kur. Aynı şeyi farklı kelimelerle tekrar etme. Hasta bir şey söylediğinde uzun açıklama yapma, kısa onayla ve devam et.`;

  let updatedGlobalPrompt = flow.global_prompt;
  if (!updatedGlobalPrompt.includes('current_time_Europe/Istanbul')) {
    updatedGlobalPrompt = dateBlock + updatedGlobalPrompt;
  }
  if (!updatedGlobalPrompt.includes('KONUŞMA TARZI')) {
    updatedGlobalPrompt += naturalBlock;
  }

  // ─── 2. Update nodes (prompts + edges) ───
  const updatedNodes = flow.nodes.map(node => {
    // Update intent detection — append rule if missing
    if (node.id === 'node_intent_detection') {
      let text = node.instruction?.text || '';
      if (!text.includes('112 yönlendirmesi YAPMA')) {
        text += `\n\nÖNEMLİ: Acil durum algıladığında hastaya tavsiyelerde BULUNMA, 112 yönlendirmesi YAPMA. Sadece acil durum node'una yönlendir. Acil durum yönetimi o node'un işi.`;
      }
      const edges = updateEdges(node.edges);
      return { ...node, instruction: { ...node.instruction, text }, edges };
    }

    // Update action nodes with new prompts
    if (PROMPTS[node.id]) {
      let text = PROMPTS[node.id];
      // Append shared rules
      if (PHONE_NODES.includes(node.id)) text += PHONE_VERIFY_RULE;
      if (ACTION_NODES.includes(node.id)) text += NO_CLOSING_RULE;
      text += FILLER_RULE;

      const edges = updateEdges(node.edges);
      return {
        ...node,
        instruction: { type: 'prompt', text },
        edges,
      };
    }

    // Update inquiry node — no custom prompt but add rules
    if (node.id === 'node_inquiry') {
      let text = node.instruction?.text || '';
      if (!text.includes('KAPANIŞ KURALI')) text += NO_CLOSING_RULE;
      if (!text.includes('TOOL ÇAĞRISI')) text += FILLER_RULE;
      const edges = updateEdges(node.edges);
      return { ...node, instruction: { ...node.instruction, text }, edges };
    }

    // Update remaining node edges (greeting, closing)
    const edges = updateEdges(node.edges);
    if (edges !== node.edges) return { ...node, edges };

    return node;
  });

  // ─── 3. Update tools — speak_during_execution: false (FIX C) ───
  const updatedTools = (flow.tools || []).map(tool => {
    if (tool.type === 'custom') {
      return { ...tool, speak_during_execution: false };
    }
    return tool;
  });

  // ─── 4. Push update ───
  await client.conversationFlow.update(FLOW_ID, {
    global_prompt: updatedGlobalPrompt,
    nodes: updatedNodes,
    tools: updatedTools,
  });

  console.log('Flow updated:');
  console.log('  - Global prompt: naturalness rules + date/time variables');
  console.log('  - All action nodes: no-closing rule + phone verification + filler control');
  console.log('  - All edges: precise transition conditions');
  console.log('  - All tools: speak_during_execution disabled');
  console.log(`  - Nodes updated: ${updatedNodes.length}`);
  console.log(`  - Tools updated: ${updatedTools.filter(t => t.type === 'custom').length}`);
}

function updateEdges(edges) {
  if (!edges) return edges;
  let changed = false;
  const result = edges.map(edge => {
    if (EDGE_UPDATES[edge.id]) {
      changed = true;
      return {
        ...edge,
        transition_condition: { type: 'prompt', prompt: EDGE_UPDATES[edge.id] },
      };
    }
    return edge;
  });
  return changed ? result : edges;
}

main().catch(err => {
  console.error('Failed:', err.message);
  if (err.error) console.error(JSON.stringify(err.error, null, 2));
  process.exit(1);
});
