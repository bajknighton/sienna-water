# Sienna's Water 🦁💧

An iPhone Home Screen app that reminds you to put water out for Sienna. It keeps nudging until one of you taps **Done**, and then it tells the other phone.

## One-time setup (about 10 minutes)

### 1. Put the files on GitHub
1. Unzip `sienna-water.zip`.
2. Go to **github.com → + (top right) → New repository**. Name it `sienna-water`, choose **Private**, and click **Create repository**.
3. On the next page, click **uploading an existing file**.
4. Open the unzipped `sienna-water` folder, select **everything inside it** (`public`, `netlify`, `netlify.toml`, `package.json`, `README.md`), and drag it onto the GitHub page. Click **Commit changes**.

### 2. Connect it to Netlify
1. In Netlify, click **Add new site → Import an existing project → GitHub**, then pick `sienna-water`.
2. Leave every setting as it is (it reads `netlify.toml`) and click **Deploy**.
3. After a minute or so you'll get a web address like `https://something.netlify.app`. You can rename it under **Site configuration → Change site name**, for example `sienna-water.netlify.app`.

No keys, passwords or database setup are needed. The app stores its data in Netlify's built-in storage and creates its own notification keys the first time it runs.

### 3. On each iPhone
1. Open the web address in **Safari**.
2. Tap **Share → Add to Home Screen → Add**.
3. Open **Sienna's Water** from the Home Screen.
4. **First phone:** choose a family code (for example `little-lion`) and enter your name. **Second phone:** type the same family code and your own name.
5. Tap **Turn on reminders**, then **Allow**.
6. Scroll down and tap **Send me a test** to check it works.

## Everyday use
- At each reminder time, both phones get "💧 Water time for Sienna!"
- If nobody taps Done, it repeats (every 15 minutes, up to 3 more times by default). You can change this in Settings.
- Tap the notification, then tap the big blue **Water's ready – Done** button. The other phone gets "✅ Sienna's water is sorted".
- Change the times under **Settings → Reminder times**. Changes apply to both phones straight away.
- **Pause all reminders** is there for holidays or sick days.

## Tips for getting noticed
- Go to iPhone **Settings → Notifications → Sienna's Water**. Turn on **Time Sensitive Notifications** if it's offered, set the banner style to **Persistent**, and turn on **Sounds** and **Badges**.
- If you use a Focus mode, add Sienna's Water to its allowed apps.

## Notes
- Reminders follow UK time (including when the clocks change).
- They're checked every 5 minutes, so they can arrive up to about 5 minutes after the set time.
- If a reminder stops arriving, open the app once. It will quietly re-register the phone.
