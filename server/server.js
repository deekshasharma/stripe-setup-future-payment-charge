const express = require("express");
const app = express();
const { resolve } = require("path");
const env = require("dotenv").config({ path: "./.env" });

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY, {
  apiVersion: '2020-08-27',
  // appInfo: { // For sample support and debugging, not required for production:
  //   name: "stripe-samples/saving-card-without-payment",
  //   version: "0.0.1",
  //   url: "https://github.com/stripe-samples/saving-card-without-payment"
});

try {
  app.use(express.static(process.env.STATIC_DIR));
} catch (e) {
  console.log("Missing env file, be sure to copy .env.example to .env");
}

app.use(
  express.json({
    // We need the raw body to verify webhook signatures.
    // Let's compute it only when hitting the Stripe webhook endpoint.
    verify: function(req, res, buf) {
      if (req.originalUrl.startsWith("/webhook")) {
        req.rawBody = buf.toString();
      }
    }
  })
);

app.get("/", (req, res) => {
  const path = resolve(process.env.STATIC_DIR + "/index.html");
  res.sendFile(path);
});

app.get("/public-key", (req, res) => {
  res.send({ publicKey: process.env.STRIPE_PUBLISHABLE_KEY });
});

//TODO: It might be a good idea to add the default payment to customer invoice settings
app.post("/create-invoice/:id", async (req, res) => {
  const paymentMethods = await stripe.paymentMethods.list({customer: req.params.id, type: 'card'});
  const paymentMethodId = paymentMethods.data[0]['id'];

  //Multiply amount by 100 to convert to cents
  const orders = await stripe.invoiceItems.create({
    customer: req.params.id,
    unit_amount: 50,
    quantity: 10,
    description: 'Extra Orders',
    currency: "usd",
  });
  const items = await stripe.invoiceItems.create({
    customer: req.params.id,
    unit_amount: 5,
    quantity: 100,
    description: 'Extra Items',
    currency: "usd",
  });

  const bandwidth = await stripe.invoiceItems.create({
    customer: req.params.id,
    unit_amount: 30,
    quantity: 2,
    description: 'Extra Bandwidth',
    currency: "usd",
  });

  const apiCalls = await stripe.invoiceItems.create({
    customer: req.params.id,
    unit_amount: 200,
    quantity: 5,
    description: 'Extra Api Calls',
    currency: "usd",
  });

  const flatFee = await stripe.invoiceItems.create({
    customer: req.params.id,
    unit_amount: 1,
    quantity: 0,
    description: 'Flat fee',
    currency: "usd",
  });

  const invoice = await stripe.invoices.create({
    customer: req.params.id,
  });
  const finalizedInvoice = await stripe.invoices.finalizeInvoice(invoice.id);
  const paidInvoice = await stripe.invoices.pay(finalizedInvoice.id, {payment_method: paymentMethodId});
  res.send({invoice: paidInvoice})
});

app.post("/create-setup-intent", async (req, res) => {
  // Create or use an existing Customer to associate with the SetupIntent.
  const customer = await stripe.customers.create({description: "Test customer", name: "Richa Dave", email: "richa@gmail.com"});
  res.send(await stripe.setupIntents.create({
    customer: customer.id
  }));
});

// Webhook handler for asynchronous events.
app.post("/webhook", async (req, res) => {
  let data;
  let eventType;

  // Check if webhook signing is configured.
  if (process.env.STRIPE_WEBHOOK_SECRET) {
    // Retrieve the event by verifying the signature using the raw body and secret.
    let event;
    let signature = req.headers["stripe-signature"];

    try {
      event = await stripe.webhooks.constructEvent(
        req.rawBody,
        signature,
        process.env.STRIPE_WEBHOOK_SECRET
      );
    } catch (err) {
      console.log(`⚠️  Webhook signature verification failed.`);
      return res.sendStatus(400);
    }
    // Extract the object from the event.
    data = event.data;
    eventType = event.type;
  } else {
    // Webhook signing is recommended, but if the secret is not configured in `config.js`,
    // retrieve the event data directly from the request body.
    data = req.body.data;
    eventType = req.body.type;
  }

  if (eventType === "setup_intent.created") {
    console.log(`🔔  A new SetupIntent is created. ${data.object.id}`);
  }

  if (eventType === "setup_intent.setup_failed") {
    console.log(`🔔  A SetupIntent has failed to set up a PaymentMethod.`);
  }

  if (eventType === "setup_intent.succeeded") {
    console.log(
      `🔔  A SetupIntent has successfully set up a PaymentMethod for future use.`
    );
  }

  if (eventType === "payment_method.attached") {
    console.log(
      `🔔  A PaymentMethod ${data.object.id} has successfully been saved to a Customer ${data.object.customer}.`
    );

    // At this point, associate the ID of the Customer object with your
    // own internal representation of a customer, if you have one.

    // Optional: update the Customer billing information with billing details from the PaymentMethod
    const customer = await stripe.customers.update(
      data.object.customer,
      {email: data.object.billing_details.email},
      () => {
        console.log(
          `🔔  Customer successfully updated.`
        );
      }
    );

  }

  res.sendStatus(200);
});

app.listen(4242, () => console.log(`Node server listening on port ${4242}!`));
