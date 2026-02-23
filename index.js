const admin = require('firebase-admin');
const serviceAccount = require('./firebase-admin.json');
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
    const riderCollection = database.collection('riders');

    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
    });

    const tokenVerify = async (req, res, next) => {
      try {
        const authHeader = req.headers.authorization;
        console.log(authHeader);
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
          return res.status(401).json({ message: 'Unauthorized access' });
        }

        const token = authHeader.split(' ')[1];

        const decodedUser = await admin.auth().verifyIdToken(token);

        req.user = decodedUser; // user info attach
        next();
      } catch (error) {
        return res.status(401).json({ message: 'Invalid or expired token' });
      }
    };

    // parcel create api
    app.post('/parcels', tokenVerify, async (req, res) => {
      try {
        const parcel = req.body;
        const result = await parcelCollection.insertOne(parcel);
        res.status(201).json(result);
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    // get all my parcel api
    app.get('/parcel', tokenVerify, async (req, res) => {
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
    app.get('/parcel/:id', tokenVerify, async (req, res) => {
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
    app.delete('/parcel/:id', tokenVerify, async (req, res) => {
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
    app.post('/payment', tokenVerify, async (req, res) => {
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
    app.get('/payment', tokenVerify, async (req, res) => {
      console.log(req.headers);
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
    // const YOUR_DOMAIN = 'http://localhost:5173';

    app.post('/create-checkout-session', tokenVerify, async (req, res) => {
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

    app.post('/riders', tokenVerify, async (req, res) => {
      try {
        const rider = req.body;
        const result = await riderCollection.insertOne(rider);
        res.status(201).json({ status: 'success', data: result });
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    app.get('/riders', tokenVerify, async (req, res) => {
      try {
        const result = await riderCollection.find().toArray();
        res.status(200).json({ status: 'success', data: result });
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
