const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const express = require('express');
require('dotenv').config();
const stripe = require('stripe')(process.env.PAYMENT_GET_WAY_KEY);
const app = express();
const cors = require('cors');
const port = process.env.PORT || 5000;

app.use(express.json());
app.use(cors());

const uri = `mongodb+srv://mdmoniruzzamanarafat_db_user:${process.env.DB_PASSWORD}@cluster0.cvx7qwv.mongodb.net/?appName=Cluster0`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    // Connect the client to the server	(optional starting in v4.7)
    await client.connect();
    // Send a ping to confirm a successful connection
    await client.db('admin').command({ ping: 1 });
    console.log(
      'Pinged your deployment. You successfully connected to MongoDB!'
    );

    const database = client.db('zapShift');
    const parcelCollection = database.collection('parcels');
    const paidParcelCollection = database.collection('paid_parcels');
    const userCollection = database.collection('users');

    // parcel create api
    app.post('/parcels', async (req, res) => {
      try {
        const parcel = req.body;
        const result = await parcelCollection.insertOne(parcel);
        res.status(201).json(result);
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    // get all my parcel api
    app.get('/parcel', async (req, res) => {
      try {
        const queryEmail = req.query.email;
        const option = {
          sort: { createdDate: -1 },
        };
        const result = await parcelCollection
          .find({ createdBy: queryEmail }, option)
          .toArray();
        res.status(200).json({
          status: 'success',
          total_data: result.length,
          data: result,
        });
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    // get single parcel
    app.get('/parcel/:id', async (req, res) => {
      try {
        const parcelId = req.params.id;
        const result = await parcelCollection.findOne({
          _id: new ObjectId(parcelId),
        });
        res.status(200).json({ status: 'success', data: result });
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    // delete single parcel
    app.delete('/parcel/:id', async (req, res) => {
      try {
        const parcelId = req.params.id;
        const result = await parcelCollection.deleteOne({
          _id: new ObjectId(parcelId),
        });
        res.status(200).json({
          status: 'success',
        });
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    // payment record and update parcel status api
    app.post('/payment', async (req, res) => {
      try {
        const { parcelId, email, amount, payment_Method, transactionId } =
          req.body;

        // update parcel payment status
        const updateResult = await parcelCollection.updateOne(
          {
            _id: new ObjectId(parcelId),
          },
          {
            $set: {
              paymentStatus: 'paid',
            },
          }
        );

        if (updateResult.modifiedCount === 0) {
          return res
            .status(404)
            .json({ message: 'parcel not found or already paid ' });
        }

        // insert payment record
        const paymentDoc = {
          parcelId,
          email,
          amount,
          transactionId,
          payment_Method,
          paidAt: new Date(),
        };

        const result = await paidParcelCollection.insertOne(paymentDoc);
        res.status(201).json({
          status: 'success',
          data: result,
        });
      } catch (error) {
        res.status(500).json({
          status: 'fail',
          message: error.message,
        });
      }
    });

    // get my payment history
    app.get('/payment', async (req, res) => {
      try {
        const queryEmail = req.query.email;
        const option = {
          sort: { paidAt: -1 },
        };
        const result = await paidParcelCollection
          .find({ email: queryEmail }, option)
          .toArray();
        res.status(200).json({
          status: 'success',
          total_data: result.length,
          data: result,
        });
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    // strip payment api
    const YOUR_DOMAIN = 'http://localhost:5173';

    app.post('/create-checkout-session', async (req, res) => {
      try {
        const session = await stripe.paymentIntents.create({
          amount: req.body.amount,
          currency: 'usd',
          payment_method_types: ['card'],
          //   return_url: `${YOUR_DOMAIN}/complete?session_id={CHECKOUT_SESSION_ID}`,
        });

        res.send({ clientSecret: session.client_secret });
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    app.post('/users', async (req, res) => {
      try {
        const email = req.body.email;

        const userExist = await userCollection.findOne({ email });
        if (userExist) {
          return res.status(200).json({
            message: 'user already exist',
            inserted: false,
          });
        }

        const user = req.body;

        const result = await userCollection.insertOne(user);
        if (result) {
          return res.status(200).json({ status: 'success', data: result });
        }
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);

app.get('/', (req, res) => {
  res.send('zap shift server');
});

app.listen(port, () => {
  console.log('server is run.........');
});
