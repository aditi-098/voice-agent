# Sanjeevani Clinic — WhatsApp + Web Voice Booking Backend

Ye ek hi backend hai jo do channels handle karta hai:
- **WhatsApp** (`/whatsapp-webhook`) — patient WhatsApp pe text karta hai, agent booking karta hai
- **Web widget** (`/chat`) — browser wale prototype ke liye (jo pehle bana tha)

Dono ek hi "brain" (Claude LLM) aur ek hi `appointments.csv` use karte hain.

## 1. Apne computer par test karna

```bash
npm install
cp .env.example .env
```

`.env` mein `ANTHROPIC_API_KEY` daalein (https://console.anthropic.com se milegi).

```bash
npm start
```

Server `http://localhost:3000` par chalega.

## 2. WhatsApp Sandbox se jodna

1. Twilio Console (legacy) mein: Messaging > Try it out > Send a WhatsApp message
2. Apne phone ke WhatsApp se diye gaye number (+14155238886) par "join <code>" bhejein
3. Local test ke liye ngrok chalayein: `ngrok http 3000`
4. Sandbox settings mein "When a message comes in" webhook mein daalein:
   `https://aapka-ngrok-url.ngrok-free.app/whatsapp-webhook`
5. Ab apne WhatsApp se us Twilio number par "Namaste" ya "mujhe appointment chahiye" likh ke bhejein — agent jawab dega

## 3. Internet par permanently deploy karna

Render.com par deploy karein (pehle README version mein steps hain), phir wahi
permanent URL Twilio sandbox ke webhook mein daal dein — tab ngrok ki zaroorat
nahi padegi.

## Zaroori limitation (abhi ke liye)

Twilio Sandbox sirf **testing ke liye** hai:
- Sirf wahi log message kar sakte hain jinhone "join" kiya ho
- Session 3 din mein expire ho jaata hai, dobara join karna padta hai
- Number par Twilio ka naam/logo dikhta hai, aapki clinic ka nahi

Jab real patients ke saath production mein jaana ho, tab Twilio ka
"WhatsApp Self Sign-up" process follow karna hoga (apna business number register
karna) — abhi testing/demo ke liye sandbox kaafi hai.

## Files
- `server.js` — poora backend (WhatsApp + web chat dono)
- `appointments.csv` — sabhi bookings (Excel mein khulti hai)
- `.env` — apni API key (kabhi GitHub par public mat karein)

## Doctors/timings badalna
`server.js` ke andar `DOCTORS` aur `SLOT_TIMES` list edit karein.
