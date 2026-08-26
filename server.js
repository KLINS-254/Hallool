require("dotenv").config();

const express = require("express");
const axios = require("axios");
const cors = require("cors");
const path = require("path");

const app = express();

app.use(cors());
app.use(express.json());

app.use(express.static(path.join(__dirname, "public")));


/* =========================================
   CONFIGURATION
========================================= */

const PORT = process.env.PORT || 3000;

const CONSUMER_KEY = process.env.CONSUMER_KEY;
const CONSUMER_SECRET = process.env.CONSUMER_SECRET;

const BUSINESS_SHORT_CODE = process.env.BUSINESS_SHORT_CODE;
const PASSKEY = process.env.PASSKEY;

const CALLBACK_URL = process.env.CALLBACK_URL;


/* =========================================
   DARAJA URLS

   SANDBOX:
   https://sandbox.safaricom.co.ke

   PRODUCTION:
   https://api.safaricom.co.ke
========================================= */

const BASE_URL =
    process.env.NODE_ENV === "production"
        ? "https://api.safaricom.co.ke"
        : "https://sandbox.safaricom.co.ke";


/* =========================================
   TEMPORARY PAYMENT STORAGE

   userPhone is the KenyaSurvey member number.

   In production, replace this with a
   database such as MongoDB, MySQL, or
   PostgreSQL.
========================================= */

const activationPayments = {};


/* =========================================
   CREATE DARAJA ACCESS TOKEN
========================================= */

async function getAccessToken() {

    try {

        const auth = Buffer
            .from(
                `${CONSUMER_KEY}:${CONSUMER_SECRET}`
            )
            .toString("base64");


        const response = await axios.get(

            `${BASE_URL}/oauth/v1/generate?grant_type=client_credentials`,

            {
                headers: {
                    Authorization: `Basic ${auth}`
                }
            }

        );


        return response.data.access_token;

    } catch (error) {

        console.error(
            "ACCESS TOKEN ERROR:",
            error.response?.data || error.message
        );

        throw new Error(
            "Unable to connect to M-Pesa."
        );

    }

}


/* =========================================
   CREATE DARAJA PASSWORD
========================================= */

function getTimestamp() {

    const now = new Date();

    const year = now.getFullYear();

    const month =
        String(
            now.getMonth() + 1
        ).padStart(2, "0");

    const day =
        String(
            now.getDate()
        ).padStart(2, "0");

    const hour =
        String(
            now.getHours()
        ).padStart(2, "0");

    const minute =
        String(
            now.getMinutes()
        ).padStart(2, "0");

    const second =
        String(
            now.getSeconds()
        ).padStart(2, "0");


    return (
        year +
        month +
        day +
        hour +
        minute +
        second
    );

}


function getPassword(timestamp) {

    return Buffer
        .from(
            BUSINESS_SHORT_CODE +
            PASSKEY +
            timestamp
        )
        .toString("base64");

}


/* =========================================
   FORMAT KENYAN PHONE NUMBER
========================================= */

function formatPhone(phone) {

    if (!phone) {
        return null;
    }


    phone =
        String(phone)
        .replace(/\s+/g, "")
        .replace(/\+/g, "");


    if (phone.startsWith("0")) {

        phone =
            "254" +
            phone.substring(1);

    }


    if (phone.startsWith("7")) {

        phone =
            "254" + phone;

    }


    if (!/^2547\d{8}$/.test(phone)) {

        return null;

    }


    return phone;

}


/* =========================================
   ACTIVATE ACCOUNT

   POST /api/activate

   Called by activate.html
========================================= */

app.post(
    "/api/activate",

    async (req, res) => {

        try {

            const paymentPhone =
                formatPhone(
                    req.body.phone
                );


            const userPhone =
                req.body.userPhone;


            /* FIXED AMOUNT */

            const amount = 350;


            if (!paymentPhone) {

                return res.status(400).json({

                    success: false,

                    message:
                        "Enter a valid Kenyan M-Pesa phone number."

                });

            }


            if (!userPhone) {

                return res.status(400).json({

                    success: false,

                    message:
                        "User account not found."

                });

            }


            /* CHECK EXISTING ACTIVATION */

            if (
                activationPayments[userPhone] &&
                activationPayments[userPhone].activated === true
            ) {

                return res.json({

                    success: true,

                    activated: true,

                    message:
                        "Your account is already activated."

                });

            }


            /* GET ACCESS TOKEN */

            const accessToken =
                await getAccessToken();


            const timestamp =
                getTimestamp();


            const password =
                getPassword(timestamp);


            /* SEND STK PUSH */

            const stkResponse =
                await axios.post(

                    `${BASE_URL}/mpesa/stkpush/v1/processrequest`,

                    {

                        BusinessShortCode:
                            BUSINESS_SHORT_CODE,

                        Password:
                            password,

                        Timestamp:
                            timestamp,

                        TransactionType:
                            "CustomerPayBillOnline",

                        Amount:
                            amount,

                        PartyA:
                            paymentPhone,

                        PartyB:
                            BUSINESS_SHORT_CODE,

                        PhoneNumber:
                            paymentPhone,

                        CallBackURL:
                            CALLBACK_URL,

                        AccountReference:
                            "KenyaSurvey",

                        TransactionDesc:
                            "KenyaSurvey Account Activation"

                    },

                    {

                        headers: {

                            Authorization:
                                `Bearer ${accessToken}`,

                            "Content-Type":
                                "application/json"

                        }

                    }

                );


            const data =
                stkResponse.data;


            /* STORE PENDING PAYMENT */

            activationPayments[userPhone] = {

                userPhone:
                    userPhone,

                paymentPhone:
                    paymentPhone,

                amount:
                    amount,

                activated:
                    false,

                status:
                    "PENDING",

                merchantRequestID:
                    data.MerchantRequestID,

                checkoutRequestID:
                    data.CheckoutRequestID,

                createdAt:
                    new Date().toISOString()

            };


            console.log(
                "STK PUSH SENT:",
                activationPayments[userPhone]
            );


            return res.json({

                success: true,

                activated: false,

                message:
                    "STK Push sent successfully.",

                checkoutRequestID:
                    data.CheckoutRequestID

            });

        } catch (error) {

            console.error(
                "STK PUSH ERROR:",
                error.response?.data || error.message
            );


            return res.status(500).json({

                success: false,

                message:
                    error.response?.data?.errorMessage ||
                    "Unable to send M-Pesa payment request."

            });

        }

    }

);


/* =========================================
   M-PESA CALLBACK

   Safaricom sends the final payment result
   here after the customer enters the PIN.
========================================= */

app.post(
    "/api/mpesa/callback",

    (req, res) => {

        try {

            console.log(
                "M-PESA CALLBACK:"
            );

            console.log(
                JSON.stringify(
                    req.body,
                    null,
                    2
                )
            );


            const callbackData =
                req.body
                ?.Body
                ?.stkCallback;


            if (!callbackData) {

                return res.status(400).json({

                    ResultCode: 1,

                    ResultDesc:
                        "Invalid callback data"

                });

            }


            const checkoutRequestID =
                callbackData.CheckoutRequestID;


            const resultCode =
                callbackData.ResultCode;


            /* FIND PAYMENT */

            let paymentKey = null;


            for (
                const key in activationPayments
            ) {

                if (
                    activationPayments[key]
                    .checkoutRequestID ===
                    checkoutRequestID
                ) {

                    paymentKey = key;

                    break;

                }

            }


            if (!paymentKey) {

                console.log(
                    "PAYMENT NOT FOUND:",
                    checkoutRequestID
                );


                return res.json({

                    ResultCode: 0,

                    ResultDesc:
                        "Accepted"

                });

            }


            const payment =
                activationPayments[paymentKey];


            /* SUCCESSFUL PAYMENT */

            if (resultCode === 0) {

                payment.status =
                    "SUCCESS";


                payment.activated =
                    true;


                payment.activatedAt =
                    new Date().toISOString();


                /* GET M-PESA RECEIPT */

                const callbackItems =
                    callbackData
                    ?.CallbackMetadata
                    ?.Item || [];


                callbackItems.forEach(item => {

                    if (
                        item.Name ===
                        "MpesaReceiptNumber"
                    ) {

                        payment.mpesaReceipt =
                            item.Value;

                    }


                    if (
                        item.Name ===
                        "TransactionDate"
                    ) {

                        payment.transactionDate =
                            item.Value;

                    }


                    if (
                        item.Name ===
                        "Amount"
                    ) {

                        payment.paidAmount =
                            item.Value;

                    }

                });


                console.log(
                    "ACTIVATION SUCCESSFUL:",
                    payment
                );

            }


            /* FAILED OR CANCELLED */

            else {

                payment.status =
                    "FAILED";


                payment.activated =
                    false;


                payment.resultCode =
                    resultCode;


                payment.resultDesc =
                    callbackData.ResultDesc;


                console.log(
                    "PAYMENT FAILED:",
                    payment
                );

            }


            return res.json({

                ResultCode: 0,

                ResultDesc:
                    "Callback received successfully"

            });

        } catch (error) {

            console.error(
                "CALLBACK ERROR:",
                error
            );


            return res.json({

                ResultCode: 0,

                ResultDesc:
                    "Accepted"

            });

        }

    }

);


/* =========================================
   CHECK ACTIVATION STATUS

   Called every 3 seconds by activate.html
========================================= */

app.post(
    "/api/check-activation",

    (req, res) => {

        const userPhone =
            req.body.userPhone;


        if (!userPhone) {

            return res.status(400).json({

                activated: false,

                message:
                    "User account not found."

            });

        }


        const payment =
            activationPayments[userPhone];


        if (!payment) {

            return res.json({

                activated: false,

                status:
                    "NO_PAYMENT"

            });

        }


        return res.json({

            activated:
                payment.activated === true,

            status:
                payment.status,

            message:
                payment.resultDesc || null

        });

    }

);


/* =========================================
   HEALTH CHECK
========================================= */

app.get(
    "/api/status",

    (req, res) => {

        res.json({

            success: true,

            message:
                "KenyaSurvey server is running."

        });

    }

);


/* =========================================
   START SERVER
========================================= */

app.listen(
    PORT,

    () => {

        console.log(
            `KenyaSurvey server running on port ${PORT}`
        );

        console.log(
            `http://localhost:${PORT}`
        );

    }

);
