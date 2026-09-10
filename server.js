// server.js
// Chhota backend jo browser aur Claude API ke beech mein rehta hai.
// Yahi agent ka "dimaag" hai — naam/phone/problem samajhna, doctor suggest
// karna, aur jab sab confirm ho jaaye tab appointment book karna.

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const Anthropic = require('@anthropic-ai/sdk');
const twilio = require('twilio');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: false })); // Twilio webhook form-data ke liye

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ---------------- Clinic data (apni clinic ke hisaab se edit karein) ----------------
const DOCTORS = [
  { name: 'Dr. Ananya Verma', specialty: 'General Physician' },
  { name: 'Dr. Farhan Iyer', specialty: 'Dentist' },
  { name: 'Dr. Ritu Khan', specialty: 'Dermatologist' },
  { name: 'Dr. Suresh Rao', specialty: 'Orthopedic' },
  { name: 'Dr. Meera Mehta', specialty: 'Cardiologist' },
  { name: 'Dr. Vikram Sharma', specialty: 'ENT' },
  { name: 'Dr. Kavita Kapoor', specialty: 'Gynecologist' },
  { name: 'Dr. Arjun Singh', specialty: 'Pediatrician' },
];
const SLOT_TIMES = ['10:00 AM', '10:20 AM', '10:40 AM', '11:00 AM', '11:20 AM', '4:00 PM', '4:20 PM', '4:40 PM'];

// ---------------- CSV storage (Excel mein khul jaati hai) ----------------
const CSV_PATH = path.join(__dirname, 'appointments.csv');
const CSV_HEADERS = ['token', 'name', 'phone', 'problem', 'doctor', 'specialty', 'date', 'time', 'booked_at'];

function ensureCsv() {
  if (!fs.existsSync(CSV_PATH)) {
    fs.writeFileSync(CSV_PATH, CSV_HEADERS.join(',') + '\n');
  }
}
function csvEscape(v) {
  return `"${String(v ?? '').replace(/"/g, '""')}"`;
}
function readAppointments() {
  ensureCsv();
  const lines = fs.readFileSync(CSV_PATH, 'utf8').trim().split('\n');
  const rows = lines.slice(1).filter(Boolean);
  return rows.map((line) => {
    const vals = line.match(/(".*?"|[^,]+)(?=,|$)/g).map((v) => v.replace(/^"|"$/g, '').replace(/""/g, '"'));
    const obj = {};
    CSV_HEADERS.forEach((h, i) => (obj[h] = vals[i]));
    return obj;
  });
}
function appendAppointment(row) {
  ensureCsv();
  const line = CSV_HEADERS.map((h) => csvEscape(row[h])).join(',') + '\n';
  fs.appendFileSync(CSV_PATH, line);
}
function nextSlot(doctorName) {
  const appts = readAppointments();
  const tomorrow = new Date(Date.now() + 86400000);
  const dateStr = tomorrow.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });
  const count = appts.filter((a) => a.doctor === doctorName && a.date === dateStr).length;
  return { date: dateStr, time: SLOT_TIMES[count % SLOT_TIMES.length], token: count + 1 };
}

// ---------------- Claude tool definition ----------------
const tools = [
  {
    name: 'book_appointment',
    description: 'Patient ka naam, phone, problem, aur chosen doctor confirm hone ke baad appointment book karta hai.',
    input_schema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: "Patient ka poora naam" },
        phone: { type: 'string', description: 'Patient ka phone number' },
        problem: { type: 'string', description: 'Patient ne jo dikkat batayi' },
        doctor_name: {
          type: 'string',
          description: 'Doctor ka exact naam list mein se: ' + DOCTORS.map((d) => d.name).join(', '),
        },
      },
      required: ['name', 'phone', 'problem', 'doctor_name'],
    },
  },
];

const SYSTEM_PROMPT = `Aap Sanjeevani Clinic ke reception ke liye ek warm, patient voice assistant hain.
Hamesha Hindi/Hinglish mein, chhote aur natural (bolne jaise) sentences mein jawab dein — ye voice ke liye hai, lamba likhit jawab mat dein.

Available doctors:
${DOCTORS.map((d) => `- ${d.name} (${d.specialty})`).join('\n')}

Conversation flow:
1. Patient ka naam poochiye (agar pata nahi hai).
2. Phone number poochiye.
3. Unki dikkat/symptoms poochiye, dhyan se suniye.
4. Symptoms ke hisaab se sabse sahi doctor suggest kijiye aur confirm kijiye ("Kya ye theek hai?").
5. Confirm hone ke baad book_appointment tool call kijiye.
6. Tool result mein mile token number, din, aur samay patient ko boliye, aur bataiye ki unhe 1 din pehle, 1 ghanta pehle, aur 30 minute pehle reminder milega.

Agar patient ki dikkat serious/emergency lage (jaise saans na aana, bahut zyada chest pain), unhe turant nazdeeki hospital/emergency jaane ki salah dijiye, appointment book mat kijiye.`;

// ---------------- Chat endpoint ----------------
app.post('/chat', async (req, res) => {
  try {
    const { messages } = req.body; // [{role:'user'|'assistant', content:'...'}, ...]

    let response = await anthropic.messages.create({
      model: 'claude-sonnet-5',
      max_tokens: 500,
      system: SYSTEM_PROMPT,
      tools,
      messages,
    });

    const toolUse = response.content.find((b) => b.type === 'tool_use');

    if (toolUse && toolUse.name === 'book_appointment') {
      const { name, phone, problem, doctor_name } = toolUse.input;
      const doctor = DOCTORS.find((d) => d.name === doctor_name) || DOCTORS[0];
      const slot = nextSlot(doctor.name);
      const row = {
        token: slot.token,
        name,
        phone,
        problem,
        doctor: doctor.name,
        specialty: doctor.specialty,
        date: slot.date,
        time: slot.time,
        booked_at: new Date().toISOString(),
      };
      appendAppointment(row);

      const followUp = await anthropic.messages.create({
        model: 'claude-sonnet-5',
        max_tokens: 300,
        system: SYSTEM_PROMPT,
        tools,
        messages: [
          ...messages,
          { role: 'assistant', content: response.content },
          {
            role: 'user',
            content: [{ type: 'tool_result', tool_use_id: toolUse.id, content: JSON.stringify(row) }],
          },
        ],
      });

      const text = followUp.content.filter((b) => b.type === 'text').map((b) => b.text).join(' ');
      return res.json({ reply: text, booking: row });
    }

    const text = response.content.filter((b) => b.type === 'text').map((b) => b.text).join(' ');
    res.json({ reply: text, booking: null });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Kuch dikkat aa gayi, dubara try karein.' });
  }
});

app.get('/appointments', (req, res) => {
  res.json(readAppointments());
});

// ---------------- Availability check + booking tool (for LiveKit Agent Builder) ----------------
// Ye endpoint agent ke "custom tool/action" se call hoga jab patient apna
// pasandida date/time bataye. Real register (CSV) check karke batata hai ki
// slot khaali hai ya nahi, aur khaali na ho to agla available slot suggest karta hai.
function parseRequestedDate(dateStr) {
  // Patient jaisa bhi format bole (10/9/26, 10 Sept, etc.), agent isse
  // ek standard 'Mon, DD Mon' format mein normalize karke bhejega — is
  // function ko us standard format ki ummeed hai. Agar parsing fail ho,
  // null return karta hai.
  const parsed = new Date(dateStr);
  if (isNaN(parsed.getTime())) return null;
  return parsed.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });
}

app.post('/api/check-and-book', (req, res) => {
  const { name, phone, problem, doctor_name, requested_date, requested_time } = req.body;

  const doctor = DOCTORS.find((d) => d.name === doctor_name) || DOCTORS[0];
  const dateStr = parseRequestedDate(requested_date) || requested_date;

  const appts = readAppointments();
  const clash = appts.find(
    (a) => a.doctor === doctor.name && a.date === dateStr && a.time === requested_time
  );

  if (clash) {
    // Slot full hai — agla khaali slot dhoondho aur suggest karo
    const sameDayCount = appts.filter((a) => a.doctor === doctor.name && a.date === dateStr).length;
    const suggestedTime = SLOT_TIMES[sameDayCount % SLOT_TIMES.length];
    return res.json({
      available: false,
      message: `${dateStr} ko ${requested_time} baje ${doctor.name} ke paas slot nahi hai. ${suggestedTime} baje ka slot khaali hai.`,
      suggested_date: dateStr,
      suggested_time: suggestedTime,
    });
  }

  // Slot khaali hai — book kar do
  const sameDayCount = appts.filter((a) => a.doctor === doctor.name && a.date === dateStr).length;
  const token = sameDayCount + 1;
  const row = {
    token,
    name,
    phone,
    problem,
    doctor: doctor.name,
    specialty: doctor.specialty,
    date: dateStr,
    time: requested_time,
    booked_at: new Date().toISOString(),
  };
  appendAppointment(row);

  res.json({
    available: true,
    message: `Appointment confirm ho gayi — ${dateStr}, ${requested_time} baje, ${doctor.name} ke saath. Token number T${token}.`,
    token,
    date: dateStr,
    time: requested_time,
  });
});

// ---------------- WhatsApp webhook ----------------
// Har patient (phone number) ki apni alag conversation yaad rakhte hain.
const whatsappConversations = {};

app.post('/whatsapp-webhook', async (req, res) => {
  const from = req.body.From; // jaise 'whatsapp:+91xxxxxxxxxx'
  const incomingText = req.body.Body || '';

  if (!whatsappConversations[from]) {
    whatsappConversations[from] = [];
  }
  const history = whatsappConversations[from];
  history.push({ role: 'user', content: incomingText });

  let replyText = 'Maaf kijiye, kuch dikkat aa gayi. Thodi der mein dubara try karein.';

  try {
    let response = await anthropic.messages.create({
      model: 'claude-sonnet-5',
      max_tokens: 400,
      system: SYSTEM_PROMPT,
      tools,
      messages: history,
    });

    const toolUse = response.content.find((b) => b.type === 'tool_use');

    if (toolUse && toolUse.name === 'book_appointment') {
      const { name, phone, problem, doctor_name } = toolUse.input;
      const doctor = DOCTORS.find((d) => d.name === doctor_name) || DOCTORS[0];
      const slot = nextSlot(doctor.name);
      const row = {
        token: slot.token,
        name,
        phone: phone || from.replace('whatsapp:', ''),
        problem,
        doctor: doctor.name,
        specialty: doctor.specialty,
        date: slot.date,
        time: slot.time,
        booked_at: new Date().toISOString(),
      };
      appendAppointment(row);

      const followUp = await anthropic.messages.create({
        model: 'claude-sonnet-5',
        max_tokens: 300,
        system: SYSTEM_PROMPT,
        tools,
        messages: [
          ...history,
          { role: 'assistant', content: response.content },
          { role: 'user', content: [{ type: 'tool_result', tool_use_id: toolUse.id, content: JSON.stringify(row) }] },
        ],
      });
      replyText = followUp.content.filter((b) => b.type === 'text').map((b) => b.text).join(' ');
    } else {
      replyText = response.content.filter((b) => b.type === 'text').map((b) => b.text).join(' ');
    }

    history.push({ role: 'assistant', content: replyText });
  } catch (err) {
    console.error('WhatsApp webhook error:', err);
  }

  const twiml = new twilio.twiml.MessagingResponse();
  twiml.message(replyText);
  res.type('text/xml').send(twiml.toString());
});

app.get('/', (req, res) => res.send('Clinic voice agent backend chal raha hai.'));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server chal raha hai: http://localhost:${PORT}`));
