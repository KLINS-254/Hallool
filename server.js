require("dotenv").config();

const express = require("express");
const axios = require("axios");
const crypto = require("crypto");
const path = require("path");

const app = express();

const PORT = process.env.PORT || 3000;

/*
=========================================================
KENYASURVEY SETTINGS
=========================================================
*/

const SURVEY_PRICE = 349;

const DARAJA_ENV =
    process.env.DARAJA_ENV || "sandbox";

const IS_SANDBOX =
    DARAJA_ENV === "sandbox";


/*
=========================================================
DARAJA URLS
=========================================================
*/

const DARAJA_BASE_URL = IS_SANDBOX
    ? "https://sandbox.safaricom.co.ke"
    : "https://api.safaricom.co.ke";


/*
=========================================================
EXPRESS
=========================================================
*/

app.use(express.json());

app.use(
    express.urlencoded({
        extended: true
    })
);


/*
=========================================================
STATIC WEBSITE
=========================================================
*/

app.use(
    express.static(
        path.join(__dirname, "public")
    )
);


/*
=========================================================
ENVIRONMENT VARIABLES
=========================================================

Your .env file should contain:

DARAJA_CONSUMER_KEY=xxxxxxxx
DARAJA_CONSUMER_SECRET=xxxxxxxx
DARAJA_SHORTCODE=174379
DARAJA_PASSKEY=xxxxxxxx
DARAJA_CALLBACK_URL=https://your-domain.com/api/mpesa/callback
SURVEY_SECRET=xxxxxxxxxxxxxxxx

=========================================================
*/

const CONSUMER_KEY =
    process.env.DARAJA_CONSUMER_KEY;

const CONSUMER_SECRET =
    process.env.DARAJA_CONSUMER_SECRET;

const SHORTCODE =
    process.env.DARAJA_SHORTCODE;

const PASSKEY =
    process.env.DARAJA_PASSKEY;

const CALLBACK_URL =
    process.env.DARAJA_CALLBACK_URL;

const SURVEY_SECRET =
    process.env.SURVEY_SECRET;


/*
=========================================================
CHECK CONFIGURATION
=========================================================
*/

if (!CONSUMER_KEY) {
    console.warn(
        "WARNING: DARAJA_CONSUMER_KEY is missing."
    );
}

if (!CONSUMER_SECRET) {
    console.warn(
        "WARNING: DARAJA_CONSUMER_SECRET is missing."
    );
}

if (!SHORTCODE) {
    console.warn(
        "WARNING: DARAJA_SHORTCODE is missing."
    );
}

if (!PASSKEY) {
    console.warn(
        "WARNING: DARAJA_PASSKEY is missing."
    );

}

if (!CALLBACK_URL) {
    console.warn(
        "WARNING: DARAJA_CALLBACK_URL is missing."
    );
}

if (!SURVEY_SECRET) {
    console.warn(
        "WARNING: SURVEY_SECRET is missing."
    );
}


/*
=========================================================
TEMPORARY PAYMENT STORAGE
=========================================================

For testing.

For production, replace this with MySQL,
PostgreSQL, MongoDB, etc.

=========================================================
*/

const payments = new Map();


/*
=========================================================
NORMALIZE KENYAN PHONE NUMBER
=========================================================
*/

function normalizePhone(phone) {

    let value =
        String(phone || "")
            .replace(/\D/g, "");

    if (
        value.startsWith("07") ||
        value.startsWith("01")
    ) {

        value =
            "254" +
            value.substring(1);

    }

    if (
        value.startsWith("+254")
    ) {

        value =
            value.substring(1);

    }

    return value;
}


/*
=========================================================
VALIDATE PHONE
=========================================================
*/

function validKenyanPhone(phone) {

    return /^254(?:7|1)\d{8}$/.test(
        phone
    );

}


/*
=========================================================
GET DARAJA ACCESS TOKEN
=========================================================
*/

async function getAccessToken() {

    const credentials =
        Buffer.from(
            `${CONSUMER_KEY}:${CONSUMER_SECRET}`
        ).toString("base64");


    const response =
        await axios.get(
            `${DARAJA_BASE_URL}/oauth/v1/generate?grant_type=client_credentials`,
            {
                headers: {
                    Authorization:
                        `Basic ${credentials}`
                }
            }
        );


    return response.data.access_token;

}


/*
=========================================================
CREATE STK PASSWORD
=========================================================
*/

function createPassword(timestamp) {

    return Buffer.from(
        `${SHORTCODE}${PASSKEY}${timestamp}`
    ).toString("base64");

}


/*
=========================================================
INITIATE STK PUSH
=========================================================
*/

async function initiateSTKPush(
    phone,
    amount,
    accountReference
) {

    const accessToken =
        await getAccessToken();


    const now =
        new Date();


    const timestamp =
        now.getFullYear().toString() +

        String(
            now.getMonth() + 1
        ).padStart(2, "0") +

        String(
            now.getDate()
        ).padStart(2, "0") +

        String(
            now.getHours()
        ).padStart(2, "0") +

        String(
            now.getMinutes()
        ).padStart(2, "0") +

        String(
            now.getSeconds()
        ).padStart(2, "0");


    const password =
        createPassword(
            timestamp
        );


    const payload = {

        BusinessShortCode:
            SHORTCODE,

        Password:
            password,

        Timestamp:
            timestamp,

        TransactionType:
            "CustomerPayBillOnline",

        Amount:
            amount,

        PartyA:
            phone,

        PartyB:
            SHORTCODE,

        PhoneNumber:
            phone,

        CallBackURL:
            CALLBACK_URL,

        AccountReference:
            accountReference,

        TransactionDesc:
            "KenyaSurvey Access"

    };


    const response =
        await axios.post(

            `${DARAJA_BASE_URL}/mpesa/stkpush/v1/processrequest`,

            payload,

            {
                headers: {

                    Authorization:
                        `Bearer ${accessToken}`,

                    "Content-Type":
                        "application/json"

                }

            }

        );


    return response.data;

}


/*
=========================================================
CREATE PAYMENT
=========================================================
*/

app.post(
    "/api/payment/create",
    async (req, res) => {

        try {

            const rawPhone =
                req.body.phone;


            const phone =
                normalizePhone(
                    rawPhone
                );


            if (
                !validKenyanPhone(
                    phone
                )
            ) {

                return res.status(400).json({

                    success: false,

                    message:
                        "Enter a valid Kenyan phone number."

                });

            }


            /*
            Unique reference for this payment.
            */

            const reference =
                "KS" +
                Date.now() +
                crypto
                    .randomBytes(3)
                    .toString("hex")
                    .toUpperCase();


            /*
            Save payment BEFORE STK Push.
            */

            const payment = {

                reference,

                phone,

                amount:
                    SURVEY_PRICE,

                status:
                    "pending",

                checkoutRequestID:
                    null,

                merchantRequestID:
                    null,

                mpesaReceipt:
                    null,

                resultCode:
                    null,

                resultDescription:
                    null,

                createdAt:
                    Date.now(),

                paidAt:
                    null,

                authorizationToken:
                    null,

                authorizedAt:
                    null

            };


            /*
            Send STK Push.
            */

            const stk =
                await initiateSTKPush(

                    phone,

                    SURVEY_PRICE,

                    reference

                );


            if (
                stk.ResponseCode !==
                "0"
            ) {

                return res.status(400).json({

                    success: false,

                    message:
                        stk.ResponseDescription ||
                        "STK Push could not be initiated."

                });

            }


            payment.checkoutRequestID =
                stk.CheckoutRequestID;


            payment.merchantRequestID =
                stk.MerchantRequestID;


            payments.set(
                stk.CheckoutRequestID,
                payment
            );


            return res.json({

                success: true,

                message:
                    "STK Push sent. Check your phone and enter your M-PESA PIN.",

                checkoutRequestID:
                    stk.CheckoutRequestID,

                reference

            });


        } catch (error) {

            console.error(
                "STK ERROR:",
                error.response?.data ||
                error.message
            );


            return res.status(500).json({

                success: false,

                message:
                    "Unable to initiate M-PESA payment."

            });

        }

    }
);


/*
=========================================================
M-PESA CALLBACK
=========================================================

Safaricom sends the actual payment result here.

The website does NOT decide whether payment succeeded.

=========================================================
*/

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


            const callback =
                req.body
                    ?.Body
                    ?.stkCallback;


            if (!callback) {

                return res.json({

                    ResultCode: 0,

                    ResultDesc:
                        "Accepted"

                });

            }


            const checkoutRequestID =
                callback.CheckoutRequestID;


            const resultCode =
                Number(
                    callback.ResultCode
                );


            const resultDescription =
                callback.ResultDesc;


            const payment =
                payments.get(
                    checkoutRequestID
                );


            if (!payment) {

                console.warn(
                    "Unknown CheckoutRequestID:",
                    checkoutRequestID
                );

                return res.json({

                    ResultCode: 0,

                    ResultDesc:
                        "Accepted"

                });

            }


            payment.resultCode =
                resultCode;


            payment.resultDescription =
                resultDescription;


            /*
            =================================================
            SUCCESSFUL PAYMENT
            =================================================
            */

            if (
                resultCode === 0
            ) {

                const metadata =
                    callback
                        .CallbackMetadata
                        ?.Item || [];


                let receipt =
                    null;


                let amount =
                    null;


                let paidPhone =
                    null;


                for (
                    const item
                    of metadata
                ) {

                    if (
                        item.Name ===
                        "MpesaReceiptNumber"
                    ) {

                        receipt =
                            String(
                                item.Value
                            );

                    }


                    if (
                        item.Name ===
                        "Amount"
                    ) {

                        amount =
                            Number(
                                item.Value
                            );

                    }


                    if (
                        item.Name ===
                        "PhoneNumber"
                    ) {

                        paidPhone =
                            String(
                                item.Value
                            );

                    }

                }


                /*
                IMPORTANT:

                Never authorize the survey unless
                the callback amount is exactly KSh 349.
                */

                if (
                    amount !==
                    SURVEY_PRICE
                ) {

                    payment.status =
                        "failed";

                    payment.resultDescription =
                        "Incorrect payment amount.";

                } else {

                    payment.status =
                        "paid";


                    payment.mpesaReceipt =
                        receipt;


                    payment.phone =
                        paidPhone ||
                        payment.phone;


                    payment.paidAt =
                        Date.now();

                }

            } else {

                /*
                User cancelled,
                insufficient funds,
                timeout, etc.
                */

                payment.status =
                    "failed";

            }


            payments.set(
                checkoutRequestID,
                payment
            );


            return res.json({

                ResultCode: 0,

                ResultDesc:
                    "Accepted"

            });


        } catch (error) {

            console.error(
                "CALLBACK ERROR:",
                error
            );


            /*
            Always acknowledge the callback.
            */

            return res.json({

                ResultCode: 0,

                ResultDesc:
                    "Accepted"

            });

        }

    }
);


/*
=========================================================
CHECK PAYMENT STATUS
=========================================================

surveys.html uses this while waiting for
the STK payment.

=========================================================
*/

app.get(
    "/api/payment/status/:checkoutRequestID",
    (req, res) => {

        const id =
            req.params.checkoutRequestID;


        const payment =
            payments.get(id);


        if (!payment) {

            return res.status(404).json({

                success: false,

                status:
                    "not_found"

            });

        }


        return res.json({

            success: true,

            status:
                payment.status,

            amount:
                payment.amount,

            receipt:
                payment.mpesaReceipt

        });

    }
);


/*
=========================================================
VERIFY M-PESA CONFIRMATION CODE
=========================================================

The code must match the receipt that came from
the verified Safaricom callback.

=========================================================
*/

app.post(
    "/api/payment/verify",
    (req, res) => {

        try {

            const {
                checkoutRequestID,
                confirmationCode
            } = req.body;


            if (
                !checkoutRequestID ||
                !confirmationCode
            ) {

                return res.status(400).json({

                    success: false,

                    message:
                        "Payment details are required."

                });

            }


            const payment =
                payments.get(
                    checkoutRequestID
                );


            if (!payment) {

                return res.status(404).json({

                    success: false,

                    message:
                        "Payment was not found."

                });

            }


            /*
            Payment must already have been
            confirmed by Safaricom.
            */

            if (
                payment.status !==
                "paid"
            ) {

                return res.status(402).json({

                    success: false,

                    message:
                        "KSh 349 payment has not yet been confirmed."

                });

            }


            const submittedCode =
                String(
                    confirmationCode
                )
                .trim()
                .toUpperCase();


            const realCode =
                String(
                    payment.mpesaReceipt ||
                    ""
                )
                .trim()
                .toUpperCase();


            if (
                !realCode ||
                submittedCode !==
                realCode
            ) {

                return res.status(403).json({

                    success: false,

                    message:
                        "Invalid M-PESA confirmation code."

                });

            }


            /*
            =================================================
            CREATE AUTHORIZATION TOKEN
            =================================================
            */

            const token =
                crypto
                    .randomBytes(48)
                    .toString("hex");


            payment.status =
                "authorized";


            payment.authorizationToken =
                token;


            payment.authorizedAt =
                Date.now();


            payments.set(
                checkoutRequestID,
                payment
            );


            return res.json({

                success: true,

                authorizationToken:
                    token,

                redirect:
                    "/question.html"

            });


        } catch (error) {

            console.error(
                "VERIFY ERROR:",
                error
            );


            return res.status(500).json({

                success: false,

                message:
                    "Unable to verify payment."

            });

        }

    }
);


/*
=========================================================
SURVEY AUTHORIZATION CHECK
=========================================================

question.html calls this before displaying
questions.

=========================================================
*/

app.get(
    "/api/survey/access",
    (req, res) => {

        try {

            const header =
                req.headers.authorization;


            if (
                !header ||
                !header.startsWith(
                    "Bearer "
                )
            ) {

                return res.status(401).json({

                    authorized: false

                });

            }


            const token =
                head
