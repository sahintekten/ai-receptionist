import express from 'express';

const app = express();
app.use(express.json());

const handlers = {
  check_availability: (args) => ({
    available_slots: [
      { date: args.preferred_date || '2026-04-02', time: '10:00', doctor: args.doctor_name || 'Güneş Tekten', duration_minutes: 30 },
      { date: args.preferred_date || '2026-04-02', time: '14:30', doctor: args.doctor_name || 'Güneş Tekten', duration_minutes: 30 },
      { date: args.preferred_date || '2026-04-03', time: '11:00', doctor: args.doctor_name || 'Güneş Tekten', duration_minutes: 30 },
    ],
    message: 'Uygun randevu saatleri listelendi.',
  }),

  create_booking: (args) => ({
    success: true,
    booking_id: 'BK-' + Date.now(),
    date: args.date || '2026-04-02',
    time: args.time || '10:00',
    doctor: args.doctor_name || 'Güneş Tekten',
    patient_name: args.caller_name || 'Hasta',
    service_type: args.service_type || 'Konsültasyon',
    message: `Randevunuz ${args.date || '2026-04-02'} tarihinde saat ${args.time || '10:00'}'da ${args.doctor_name || 'doktorumuz'} ile oluşturuldu.`,
  }),

  lookup_bookings: (args) => ({
    bookings: [
      { booking_id: 'BK-1001', date: '2026-04-05', time: '10:00', doctor: 'Uzm. Dr. Güneş Tekten', service: 'Mide Balonu Konsültasyon', status: 'confirmed' },
      { booking_id: 'BK-1002', date: '2026-04-12', time: '14:00', doctor: 'Prof. Dr. Bahattin Çeliköz', service: 'Rinoplasti Konsültasyon', status: 'confirmed' },
    ],
    caller_phone: args.caller_phone || '+905551234567',
    message: '2 adet randevu bulundu.',
  }),

  cancel_booking: (args) => ({
    success: true,
    cancelled_booking_id: args.booking_id || 'BK-1001',
    message: `${args.booking_id || 'BK-1001'} numaralı randevunuz başarıyla iptal edildi.`,
  }),

  take_message: (args) => ({
    success: true,
    message_id: 'MSG-' + Date.now(),
    type: args.message_type || 'message',
    message: `Mesajınız kaydedildi. En kısa sürede size dönüş yapılacaktır.`,
  }),

  get_caller_memory: (args) => ({
    caller_phone: args.caller_phone || '+905551234567',
    caller_name: 'Ayşe Yılmaz',
    last_call_at: '2026-03-28T14:30:00Z',
    recent_appointment_status: 'Mide balonu konsültasyonu tamamlandı',
    recent_message_summary: 'Fiyat bilgisi talep etti, geri arama sözü verildi',
  }),

  get_business_hours: () => ({
    hours: {
      pazartesi: '09:00 - 18:30',
      sali: '09:00 - 18:30',
      carsamba: '09:00 - 18:30',
      persembe: '09:00 - 18:30',
      cuma: '09:00 - 18:30',
      cumartesi: '09:00 - 18:30',
      pazar: 'Kapalı',
    },
    message: 'Tekten Klinik Pazartesi-Cumartesi 09:00-18:30 arası hizmet vermektedir. Pazar günü kapalıdır.',
  }),

  get_emergency_info: () => ({
    emergency_situations: [
      'Ameliyat sonrası komplikasyonlar: ateş, anormal kanama, ciddi şişlik, enfeksiyon belirtileri',
      'Mide balonu sonrası: şiddetli mide ağrısı, sürekli kusma, nefes darlığı',
      'Alerjik reaksiyon: yaygın şişlik, nefes darlığı, döküntü',
    ],
    emergency_number: '112',
    clinic_phone: '+90 555 822 44 44',
    message: 'Hayati tehlike durumunda lütfen önce 112\'yi arayın. Ardından kliniğimizi arayabilirsiniz.',
  }),
};

app.post('/{*splat}', (req, res) => {
  const { name, args } = req.body;
  const fnName = name || req.path.replace(/^\//, '');

  console.log(`[${new Date().toISOString()}] ${fnName}`, JSON.stringify(args || {}).slice(0, 200));

  const handler = handlers[fnName];
  if (handler) {
    const result = handler(args || {});
    console.log(`  → OK:`, JSON.stringify(result).slice(0, 200));
    return res.json(result);
  }

  console.log(`  → Unknown function: ${fnName}`);
  res.status(400).json({ error: `Bilinmeyen fonksiyon: ${fnName}` });
});

app.listen(3000, () => {
  console.log('Mock server running on http://localhost:3000');
  console.log('Functions:', Object.keys(handlers).join(', '));
});
