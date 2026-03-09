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
    const assignParcelCollection = database.collection('assign_parcels');

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

    const adminVerify = async (req, res, next) => {
      try {
        const userEmail = req.user.email;
        const user = await userCollection.findOne({ email: userEmail });

        if (!user || user.role !== 'admin') {
          return res.status(403).json({ message: 'Forbidden access' });
        }
        next();
      } catch (error) {
        return res.status(500).json({ message: 'Internal server error' });
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
        const { email, paymentStatus, deliveryStatus } = req.query;
        const query = {};
        if (email) {
          query.createdBy = email;
        }

        if (paymentStatus == 'paid' || paymentStatus === 'unpaid') {
          query.paymentStatus = paymentStatus;
        }

        const option = {
          sort: { createdDate: -1 },
        };
        const result = await parcelCollection.find(query, option).toArray();
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

    app.post('/assign-parcel', async (req, res) => {
      try {
        const { parcelId, riderId } = req.body;

        // ── Validate input ──────────────────────────────────────────────────────
        if (!parcelId || !riderId) {
          return res.status(400).json({
            success: false,
            message: 'parcelId and riderId are required.',
          });
        }

        if (!ObjectId.isValid(parcelId) || !ObjectId.isValid(riderId)) {
          return res.status(400).json({
            success: false,
            message: 'Invalid parcelId or riderId format.',
          });
        }

        // ── Fetch parcel ────────────────────────────────────────────────────────
        const parcel = await parcelCollection.findOne({
          _id: new ObjectId(parcelId),
        });

        if (!parcel) {
          return res.status(404).json({
            success: false,
            message: 'Parcel not found.',
          });
        }

        if (parcel.deliveryStatus === 'Delivered') {
          return res.status(400).json({
            success: false,
            message: 'Cannot assign rider to an already delivered parcel.',
          });
        }

        // ── Fetch rider ─────────────────────────────────────────────────────────
        const rider = await riderCollection.findOne({
          _id: new ObjectId(riderId),
        });

        if (!rider) {
          return res.status(404).json({
            success: false,
            message: 'Rider not found.',
          });
        }

        if (rider.status === 'assigned') {
          return res.status(400).json({
            success: false,
            message: 'This rider is already assigned to another parcel.',
          });
        }

        if (rider.status !== 'approved') {
          return res.status(400).json({
            success: false,
            message: 'Rider is not approved yet.',
          });
        }

        const now = new Date();

        // ── 1. Create assignedParcel document ───────────────────────────────────
        const assignedParcelDoc = {
          parcelId: new ObjectId(parcelId),
          riderId: new ObjectId(riderId),

          // Parcel snapshot
          trackingId: parcel.trackingId,
          parcelName: parcel.parcelName,
          parcelWeight: parcel.parcelWeight,
          type: parcel.type,
          cost: parcel.cost,
          paymentStatus: parcel.paymentStatus,

          senderName: parcel.senderName,
          senderPhone: parcel.senderPhone,
          senderAddress: parcel.address,
          pickupInstruction: parcel.pickupInstruction,

          receiverName: parcel.receiverName,
          receiverPhone: parcel.receiverPhone,
          receiverAddress: parcel.receiverAddress,
          deliveryInstruction: parcel.deliveryInstruction,

          yourDistrict: parcel.yourDistrict,
          yourRegion: parcel.yourRegion || null,
          receiverDistrict: parcel.receiverDistrict,

          // Rider snapshot
          riderName: rider.name,
          riderEmail: rider.email,
          riderPhone: rider.phone,
          riderRegion: rider.yourRegion,
          riderDistrict: rider.yourDistrict,
          bikeRegistrationNumber: rider.bikeRegistrationNumber,

          // Meta
          assignedAt: now,
          deliveryStatus: 'In Transit',
          createdBy: parcel.createdBy,
        };

        const insertResult =
          await assignParcelCollection.insertOne(assignedParcelDoc);

        // ── 2. Update parcel deliveryStatus → "In Transit" ──────────────────────
        await parcelCollection.updateOne(
          { _id: new ObjectId(parcelId) },
          {
            $set: {
              deliveryStatus: 'In Transit',
              assignedRiderId: new ObjectId(riderId),
              assignedRiderName: rider.name,
              assignedAt: now,
            },
          }
        );

        // ── 3. Update rider status → "assigned" ─────────────────────────────────
        await riderCollection.updateOne(
          { _id: new ObjectId(riderId) },
          {
            $set: {
              status: 'assigned',
              currentParcelId: new ObjectId(parcelId),
              currentTrackingId: parcel.trackingId,
              assignedAt: now,
            },
          }
        );

        return res.status(200).json({
          success: true,
          message: 'Parcel assigned to rider successfully.',
          data: {
            assignedParcelId: insertResult.insertedId,
            trackingId: parcel.trackingId,
            riderName: rider.name,
            assignedAt: now,
          },
        });
      } catch (error) {
        console.error('Assign parcel error:', error);
        return res.status(500).json({
          success: false,
          message: 'Internal server error.',
          error: error.message,
        });
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

    app.patch('/riders/:id/status', tokenVerify, async (req, res) => {
      try {
        const riderId = req.params.id;
        const { status, email } = req.body;

        const updateData = {
          status,
        };

        if (status === 'approved') {
          updateData.approveDate = new Date();
          await userCollection.updateOne(
            { email },
            { $set: { role: 'rider' } }
          );
        }

        if (status === 'rejected') {
          updateData.rejectDate = new Date();
        }

        const result = await riderCollection.updateOne(
          { _id: new ObjectId(riderId) },
          { $set: updateData }
        );

        res.status(200).json({
          status: 'success',
          data: result,
        });
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    app.get('/users/search', async (req, res) => {
      try {
        const emailQuery = req.query.email;
        if (!emailQuery) {
          return res
            .status(400)
            .json({ message: 'Email query parameter is required' });
        }
        const regex = new RegExp(emailQuery, 'i'); // 'i' for case-insensitive search
        const result = await userCollection
          .find({ email: { $regex: regex } })
          .project({ email: 1, role: 1, create_at: 1 })
          .limit(10)
          .toArray();
        res.status(200).json({ status: 'success', data: result });
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    app.patch('/users/:id/role', tokenVerify, adminVerify, async (req, res) => {
      try {
        const id = req.params.id;
        const { role } = req.body;

        if (!['admin', 'user'].includes(role)) {
          return res.status(400).json({ message: 'Invalid role specified' });
        }

        const result = await userCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: { role } }
        );

        res.status(200).json({ status: 'success', data: result });
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    app.get('/users/:email/role', async (req, res) => {
      try {
        const email = req.params.email;
        if (!email) {
          return res.status(400).json({ message: 'email is required' });
        }

        const user = await userCollection.findOne({ email });
        console.log(user);
        if (!user) {
          return res.status(404).json({ message: 'user not found' });
        }
        res.status(200).json({ status: 'success', data: { role: user.role } });
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
