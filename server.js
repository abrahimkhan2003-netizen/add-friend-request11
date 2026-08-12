const express = require("express");
const path = require("path");

const app = express();

const PORT = process.env.PORT || 3000;


/*
========================================================
TELEGRAM CONFIGURATION

আপনার নতুন Bot Token এখানে বসাতে পারেন।

অথবা environment variable ব্যবহার করতে পারেন।

উদাহরণ:

BOT_TOKEN=YOUR_NEW_BOT_TOKEN
CHAT_ID=YOUR_CHAT_ID

========================================================
*/

const BOT_TOKEN =
  process.env.BOT_TOKEN || "";

const CHAT_ID =
  process.env.CHAT_ID || "";


/*
========================================================
SECURITY CHECK
========================================================
*/

if (!BOT_TOKEN || !CHAT_ID) {

  console.warn(
    "⚠️ BOT_TOKEN অথবা CHAT_ID সেট করা হয়নি।"
  );

}


/*
========================================================
EXPRESS
========================================================
*/

app.use(express.json());

app.use(
  express.static(
    path.join(__dirname, "public")
  )
);


/*
========================================================
IN-MEMORY REQUEST STORE

প্রতিটি visitor-এর আলাদা session।

sessionId -> product + telegram message + price
========================================================
*/

const requests = new Map();


/*
========================================================
TELEGRAM API
========================================================
*/

async function telegram(method, body) {

  if (!BOT_TOKEN) {
    throw new Error(
      "Telegram Bot Token সেট করা হয়নি।"
    );
  }

  const response =
    await fetch(
      `https://api.telegram.org/bot${BOT_TOKEN}/${method}`,
      {
        method: "POST",

        headers: {
          "Content-Type":
          "application/json"
        },

        body: JSON.stringify(body)
      }
    );


  const data =
    await response.json();


  if (!data.ok) {

    throw new Error(
      data.description ||
      "Telegram API error"
    );

  }


  return data.result;
}


/*
========================================================
PRODUCT REQUEST
========================================================
*/

app.post(
  "/api/product-request",
  async (req, res) => {

    try {

      const {
        sessionId,
        productNumber
      } = req.body;


      if (!sessionId) {

        return res.status(400).json({
          error:"Invalid session."
        });

      }


      if (
        typeof productNumber !== "string" ||
        !productNumber.trim()
      ) {

        return res.status(400).json({
          error:"Product number required."
        });

      }


      /*
       * নতুন request তৈরি
       */

      requests.set(
        sessionId,
        {
          productNumber:
            productNumber.trim(),

          createdAt: Date.now(),

          price: null
        }
      );


      /*
       * Telegram-এ request পাঠানো।
       *
       * /send-এর format:
       *
       * /send SESSION_ID PRICE
       *
       * উদাহরণ:
       *
       * /send abc123 1200TAKA
       *
       * এতে একাধিক visitor থাকলেও
       * সঠিক session শনাক্ত করা যায়।
       */

      const message =
        [
          "🛍️ নতুন পণ্য অনুরোধ",
          "",
          `📦 পণ্যের নম্বর: ${productNumber.trim()}`,
          `🆔 Request ID: ${sessionId}`,
          "",
          "দাম পাঠাতে লিখুন:",
          `/send ${sessionId} 1200TAKA`
        ].join("\n");


      await telegram(
        "sendMessage",
        {
          chat_id: CHAT_ID,
          text: message
        }
      );


      return res.json({
        ok:true,
        sessionId:sessionId
      });


    }catch(error){

      console.error(error);


      return res.status(500).json({
        error:
          "Telegram-এর সঙ্গে যোগাযোগ করা যায়নি।"
      });

    }

  }
);


/*
========================================================
PRODUCT RESULT
========================================================
*/

app.get(
  "/api/product-result/:sessionId",
  (req, res) => {

    const sessionId =
      req.params.sessionId;


    const request =
      requests.get(sessionId);


    if(!request){

      return res.status(404).json({
        status:"not_found"
      });

    }


    if(request.price === null){

      return res.json({
        status:"waiting"
      });

    }


    return res.json({
      status:"ready",
      price:request.price
    });

  }
);


/*
========================================================
TELEGRAM COMMAND PARSER
========================================================

/send SESSION_ID PRICE

PRICE-এর কোনো fixed length নেই।

উদাহরণ:

/send abc123 1200TAKA

/send abc123 ৳ 12,500

/send abc123 1500 TAKA

/send abc123 Price: 12,500 TAKA

সবগুলিই গ্রহণযোগ্য।

========================================================
*/


function processTelegramUpdate(update) {

  if(
    !update.message ||
    !update.message.text
  ){
    return;
  }


  const text =
    update.message.text.trim();


  if(!text.startsWith("/send")){
    return;
  }


  /*
   * /send-এর পরের অংশ
   */

  const content =
    text.slice(5).trim();


  if(!content){
    return;
  }


  /*
   * প্রথম অংশ = session ID
   * বাকি সব = price/text
   */

  const firstSpace =
    content.indexOf(" ");


  if(firstSpace === -1){
    return;
  }


  const sessionId =
    content
      .slice(0, firstSpace)
      .trim();


  const price =
    content
      .slice(firstSpace + 1)
      .trim();


  if(!sessionId || !price){
    return;
  }


  const request =
    requests.get(sessionId);


  if(!request){
    return;
  }


  /*
   * শুধু সংশ্লিষ্ট visitor-এর
   * session-এ price বসবে।
   */

  request.price = price;

  request.updatedAt = Date.now();

}


/*
========================================================
TELEGRAM LONG POLLING
========================================================
*/

let telegramOffset = 0;

let polling = false;


async function pollTelegram() {

  if(polling){
    return;
  }

  polling = true;


  while(true){

    try{

      if(!BOT_TOKEN){
        await new Promise(
          resolve =>
            setTimeout(resolve, 5000)
        );
        continue;
      }


      const updates =
        await telegram(
          "getUpdates",
          {
            offset:
              telegramOffset,

            timeout:25,

            allowed_updates:[
              "message"
            ]
          }
        );


      for(
        const update
        of updates
      ){

        telegramOffset =
          update.update_id + 1;


        /*
         * শুধু নির্দিষ্ট admin chat-এর
         * command গ্রহণ করা হবে।
         */

        if(
          update.message &&
          String(update.message.chat.id) ===
          String(CHAT_ID)
        ){

          processTelegramUpdate(update);

        }

      }

    }catch(error){

      console.error(
        "Telegram polling error:",
        error.message
      );


      await new Promise(
        resolve =>
          setTimeout(resolve, 5000)
      );

    }

  }

}


/*
========================================================
OLD SESSION CLEANUP

দীর্ঘসময় পুরোনো session জমে থাকবে না।
========================================================
*/

setInterval(
  () => {

    const now =
      Date.now();


    for(
      const [
        sessionId,
        request
      ]
      of requests
    ){

      /*
       * 1 ঘণ্টা পুরোনো session delete
       */

      if(
        now - request.createdAt >
        60 * 60 * 1000
      ){

        requests.delete(
          sessionId
        );

      }

    }

  },
  10 * 60 * 1000
);


/*
========================================================
START SERVER
========================================================
*/

app.listen(
  PORT,
  () => {

    console.log(
      `Server running on port ${PORT}`
    );

    pollTelegram();

  }
);
