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
    if (node.id === 'node_urgent_escalation') {
      return {
        ...node,
        instruction: {
          type: 'prompt',
          text: `ACİL DURUM — hastanın durumunu sakin ve güven verici bir şekilde değerlendir.

ADIM 1 — SAKİNLEŞTİR VE DİNLE:
- Hastayı sakinleştir: 'Efendim, anlıyorum, endişelenmeniz çok doğal. Sizinle ilgileniyorum.'
- Belirtileri kısa ve net şekilde dinle, not al
- Panik yaratma, sakin ol

ADIM 2 — BİLGİ AL:
- Hastanın adını ve telefon numarasını al (zaten varsa tekrar sorma)
- 'Doktorumuza hemen iletebilmem için adınızı ve numaranızı alabilir miyim efendim?'

ADIM 3 — KAYDET VE BİLDİR:
- take_message tool'unu message_type: 'urgent' ile MUTLAKA çağır
- Tool çağrılmadan kapanışa GEÇİLMEMELİ
- Başarılı olduktan sonra: 'Efendim, durumunuzu doktorumuza acil olarak ilettim. Size en kısa sürede geri dönüş yapacak. Lütfen telefonunuzu açık tutun.'

ADIM 4 — SADECE HAYATİ TEHLİKEDE 112:
- 112 yönlendirmesi SADECE şu durumlarda: nefes alamıyor, bilinç kaybı, kontrol edilemeyen kanama
- Bu durumda: 'Efendim, bu durumda lütfen hemen 112'yi arayın. Ardından bizi tekrar arayabilirsiniz.'
- Diğer tüm acil durumlarda (ateş, ağrı, şişlik, kusma) 112 DEĞİL, doktora iletim yap

ZORUNLU KURALLAR:
- take_message(type=urgent) ÇAĞRILMADAN kapanışa GEÇİLMEMELİ
- İsim ve telefon ALINMADAN take_message ÇAĞRILMAMALI
- Hastayı her zaman sakinleştir, panik yaratma
- 112 sadece hayati tehlike durumlarında söylen`,
        },
      };
    }
    if (node.id === 'node_message_taking') {
      return {
        ...node,
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
- Tool çağrısı başarısız olursa hastaya bildir ve tekrar dene`,
        },
      };
    }
    if (node.id === 'node_booking') {
      return {
        ...node,
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
Fiyat sorulursa: 'Fiyatlarımız muayene sonrasında belirleniyor efendim, size bir konsültasyon randevusu ayarlayabilirim.'`,
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
