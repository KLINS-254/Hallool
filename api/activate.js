const axios = require("axios");

/* =========================================
   CONFIGURATION
========================================= */

const CONSUMER_KEY = process.env.CONSUMER_KEY;
const CONSUMER_SECRET = process.env.CONSUMER_SECRET;

const BUSINESS_SHORT_CODE = process.env.BUSINESS_SHORT_CODE;
const PASSKEY = process.env.PASSKEY;

const CALLBACK_URL = process.env.CALLBACK_URL;

const DARAJA_BASE_URL =
    process.env.DARAJA_BASE_URL ||
    "https://sandbox.safaricom.co.ke";


/* =========================================
   TEMPORARY PAYMENT STORAGE

   NOTE:
   This storage is temporary and may reset on
   Vercel. Redis/database storage should be
   used for production.
========================================= */

const activationPayments = global.activationPayments || {};

global.activationPayments = activationPayments;


/* =========================================
   VALIDATE ENVIRONMENT VARIABLES
========================================= */

function validateEnvironment() {

    const required = {

        CONSUMER_KEY,
        CONSUMER_SECRET,
        BUSINESS_SHORT_CODE,
        PASSKEY,
        CALLBACK_URL

    };


    const missing = Object.keys(required)
        .filter(
            key =>
                !required[key] ||
                String(required[key])
                    .includes("your_")
        );


    if (missing.length > 0) {

        throw new Error(
            "Missing environment variables: " +
            missing.join(", ")
        );

    }

}


/* =========================================
   CREATE DARAJA ACCESS TOKEN
========================================= */

async function getAccessToken() {

    const auth = Buffer
        .from(
            `${CONSUMER_KEY}:${CONSUMER_SECRET}`
        )
        .toString("base64");


    try {

        const response = await axios.get(

            `${DARAJA_BASE_URL}/oauth/v1/generate?grant_type=client_credentials`,

            {

                headers: {

                    Authorization:
                        `Basic ${auth}`

                }

            }

        );


        const accessToken =
            response.data.access_token;


        if (!accessToken) {

            throw new Error(
                "No access token returned by Daraja."
            );

        }


        return accessToken;

    }

    catch (error) {

        console.error(
            "ACCESS TOKEN ERROR:",
            error.response?.data ||
            error.message
        );


        throw new Error(

            error.response?.data?.errorMessage ||
            error.response?.data?.error_description ||
            "Unable to generate M-Pesa access token."

        );

    }

}


/* =========================================
   GENERATE TIMESTAMP

   Format:
   YYYYMMDDHHmmss
========================================= */

function getTimestamp() {

    const now = new Date();


    const year =
        now.getFullYear();


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


/* =========================================
   GENERATE STK PASSWORD
========================================= */

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
            .trim()
            .replace(/\s+/g, "")
            .replace(/^\+/, "");


    if (phone.startsWith("0")) {

        phone =
            "254" +
            phone.substring(1);

    }


    else if (phone.startsWith("7")) {

        phone =
            "254" + phone;

    }


    if (!/^2547\d{8}$/.test(phone)) {

        return null;

    }


    return phone;

}


/* =========================================
   VERCEL SERVERLESS FUNCTION

   POST /api/activate
========================================= */

module.exports = async (req, res) => {

    /* ALLOW POST ONLY */

    if (req.method !== "POST") {

        return res.status(405).json({

            success: false,

            message:
                "Method not allowed. Use POST."

        });

    }


    try {

        validateEnvironment();


        const paymentPhone =
            formatPhone(
                req.body?.phone
            );


        const userPhone =
            req.body?.userPhone;


        const amount = 350;


        /* VALIDATE PHONE */

        if (!paymentPhone) {

            return res.status(400).json({

                success: false,

                message:
                    "Enter a valid Kenyan M-Pesa phone number."

            });

        }


        /* VALIDATE USER */

        if (!userPhone) {

            return res.status(400).json({

                success: false,

                message:
                    "User account not found."

            });

        }


        /* CHECK ACTIVATION */

        if (

            activationPayments[userPhone] &&

            activationPayments[userPhone]
                .activated === true

        ) {

            return res.status(200).json({

                success: true,

                activated: true,

                message:
                    "Your account is already activated."

            });

        }


        /* GET ACCESS TOKEN */

        const accessToken =
            await getAccessToken();


        /* CREATE TIMESTAMP + PASSWORD */

        const timestamp =
            getTimestamp();


        const password =
            getPassword(timestamp);


        /* SEND STK PUSH */

        const stkResponse =
            await axios.post(

                `${DARAJA_BASE_URL}/mpesa/stkpush/v1/processrequest`,

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
                        "Account Activation"

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


        /* CHECK DARAJA RESPONSE */

        if (

            !data.CheckoutRequestID ||

            String(data.ResponseCode) !== "0"

        ) {

            console.error(
                "DARAJA STK ERROR:",
                data
            );


            return res.status(400).json({

                success: false,

                message:
                    data.ResponseDescription ||
                    data.CustomerMessage ||
                    "M-Pesa rejected the payment request."

            });

        }


        /* STORE PAYMENT */

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


        /* SUCCESS RESPONSE */

        return res.status(200).json({

            success: true,

            activated: false,

            status:
                "PENDING",

            message:
                data.CustomerMessage ||
                "STK Push sent successfully.",

            checkoutRequestID:
                data.CheckoutRequestID

        });

    }


    catch (error) {

        console.error(
            "ACTIVATE ERROR:",
            error.response?.data ||
            error.message ||
            error
        );


        return res.status(500).json({

            success: false,

            message:

                error.response?.data?.errorMessage ||

                error.response?.data?.ResponseDescription ||

                error.message ||

                "Unable to send M-Pesa payment request."

        });

    }

};
