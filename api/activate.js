const axios = require("axios");

/* =========================================
   CONFIGURATION
========================================= */

const CONSUMER_KEY = process.env.CONSUMER_KEY;
const CONSUMER_SECRET = process.env.CONSUMER_SECRET;

const BUSINESS_SHORT_CODE = process.env.BUSINESS_SHORT_CODE;
const PASSKEY = process.env.PASSKEY;

const CALLBACK_URL = process.env.CALLBACK_URL;

const BASE_URL =
    process.env.NODE_ENV === "production"
        ? "https://api.safaricom.co.ke"
        : "https://sandbox.safaricom.co.ke";


/* =========================================
   FORMAT KENYAN PHONE NUMBER
========================================= */

function formatPhone(phone) {

    if (!phone) {
        return null;
    }

    phone = String(phone)
        .replace(/\s+/g, "")
        .replace(/\+/g, "");

    if (phone.startsWith("0")) {
        phone = "254" + phone.substring(1);
    }

    if (phone.startsWith("7")) {
        phone = "254" + phone;
    }

    if (!/^2547\d{8}$/.test(phone)) {
        return null;
    }

    return phone;
}


/* =========================================
   CREATE TIMESTAMP
========================================= */

function getTimestamp() {

    const now = new Date();

    const year = now.getFullYear();

    const month = String(
        now.getMonth() + 1
    ).padStart(2, "0");

    const day = String(
        now.getDate()
    ).padStart(2, "0");

    const hour = String(
        now.getHours()
    ).padStart(2, "0");

    const minute = String(
        now.getMinutes()
    ).padStart(2, "0");

    const second = String(
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
   CREATE DARAJA PASSWORD
========================================= */

function getPassword(timestamp) {

    return Buffer.from(
        BUSINESS_SHORT_CODE +
        PASSKEY +
        timestamp
    ).toString("base64");

}


/* =========================================
   GET ACCESS TOKEN
========================================= */

async function getAccessToken() {

    const auth = Buffer.from(
        `${CONSUMER_KEY}:${CONSUMER_SECRET}`
    ).toString("base64");


    const response = await axios.get(
        `${BASE_URL}/oauth/v1/generate?grant_type=client_credentials`,
        {
            headers: {
                Authorization: `Basic ${auth}`
            }
        }
    );


    return response.data.access_token;
}


/* =========================================
   POST /api/activate
========================================= */

module.exports = async (req, res) => {

    /* ONLY ALLOW POST */

    if (req.method !== "POST") {

        return res.status(405).json({
            success: false,
            message: "Method not allowed."
        });

    }


    try {

        const paymentPhone =
            formatPhone(req.body.phone);


        const userPhone =
            req.body.userPhone;


        /* FIXED ACTIVATION AMOUNT */

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


        /* CHECK ENVIRONMENT VARIABLES */

        if (
            !CONSUMER_KEY ||
            !CONSUMER_SECRET ||
            !BUSINESS_SHORT_CODE ||
            !PASSKEY ||
            !CALLBACK_URL
        ) {

            console.error(
                "Missing M-Pesa environment variables."
            );


            return res.status(500).json({

                success: false,

                message:
                    "Payment server configuration is incomplete."

            });

        }


        /* GET ACCESS TOKEN */

        const accessToken =
            await getAccessToken();


        /* CREATE PASSWORD */

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


        console.log(
            "STK PUSH SENT:",
            data
        );


        /* RETURN RESPONSE TO activate.html */

        return res.status(200).json({

            success: true,

            message:
                "STK Push sent successfully. Enter your M-Pesa PIN to complete payment.",

            checkoutRequestID:
                data.CheckoutRequestID,

            merchantRequestID:
                data.MerchantRequestID,

            amount:
                amount

        });

    }


    catch (error) {

        console.error(
            "STK PUSH ERROR:",
            error.response?.data || error.message
        );


        return res.status(500).json({

            success: false,

            message:

                error.response
                    ?.data
                    ?.errorMessage

                ||

                error.response
                    ?.data
                    ?.ResponseDescription

                ||

                "Unable to send M-Pesa payment request."

        });

    }

};
