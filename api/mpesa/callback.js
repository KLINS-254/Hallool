const axios = require("axios");

/* =========================================
   M-PESA CALLBACK URL

   https://hallool-ochre.vercel.app/api/mpesa/callback
========================================= */


/* =========================================
   REDIS CONFIGURATION

   Used to permanently store payment status
   between Vercel serverless functions.
========================================= */

const REDIS_URL =
    process.env.UPSTASH_REDIS_REST_URL;

const REDIS_TOKEN =
    process.env.UPSTASH_REDIS_REST_TOKEN;


/* =========================================
   SAVE PAYMENT DATA
========================================= */

async function savePayment(checkoutRequestID, data) {

    if (!REDIS_URL || !REDIS_TOKEN) {

        throw new Error(
            "Payment database configuration is missing."
        );

    }


    await axios.post(

        `${REDIS_URL}/set/activation:${checkoutRequestID}`,

        JSON.stringify(data),

        {

            headers: {

                Authorization:
                    `Bearer ${REDIS_TOKEN}`,

                "Content-Type":
                    "application/json"

            }

        }

    );

}


/* =========================================
   M-PESA CALLBACK
========================================= */

module.exports = async (req, res) => {

    /* SAFARICOM USES POST */

    if (req.method !== "POST") {

        return res.status(405).json({

            ResultCode: 1,

            ResultDesc:
                "Method not allowed"

        });

    }


    try {

        console.log(
            "M-PESA CALLBACK RECEIVED:"
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

            console.log(
                "INVALID CALLBACK DATA"
            );


            return res.status(400).json({

                ResultCode: 1,

                ResultDesc:
                    "Invalid callback data"

            });

        }


        /* =========================================
           PAYMENT DETAILS
        ========================================= */

        const checkoutRequestID =
            callbackData.CheckoutRequestID;


        const merchantRequestID =
            callbackData.MerchantRequestID;


        const resultCode =
            callbackData.ResultCode;


        const resultDesc =
            callbackData.ResultDesc;


        let paymentData = {

            checkoutRequestID:
                checkoutRequestID,

            merchantRequestID:
                merchantRequestID,

            resultCode:
                resultCode,

            resultDesc:
                resultDesc,

            status:
                "FAILED",

            activated:
                false,

            updatedAt:
                new Date().toISOString()

        };


        /* =========================================
           SUCCESSFUL PAYMENT
        ========================================= */

        if (resultCode === 0) {

            paymentData.status =
                "SUCCESS";


            paymentData.activated =
                true;


            const callbackItems =
                callbackData
                    ?.CallbackMetadata
                    ?.Item || [];


            callbackItems.forEach(item => {

                if (
                    item.Name ===
                    "Amount"
                ) {

                    paymentData.amount =
                        item.Value;

                }


                if (
                    item.Name ===
                    "MpesaReceiptNumber"
                ) {

                    paymentData.mpesaReceipt =
                        item.Value;

                }


                if (
                    item.Name ===
                    "TransactionDate"
                ) {

                    paymentData.transactionDate =
                        item.Value;

                }


                if (
                    item.Name ===
                    "PhoneNumber"
                ) {

                    paymentData.paymentPhone =
                        item.Value;

                }

            });


            console.log(
                "PAYMENT SUCCESSFUL:",
                paymentData
            );

        }


        /* =========================================
           FAILED OR CANCELLED PAYMENT
        ========================================= */

        else {

            console.log(
                "PAYMENT FAILED OR CANCELLED:",
                paymentData
            );

        }


        /* =========================================
           SAVE FINAL PAYMENT RESULT
        ========================================= */

        await savePayment(

            checkoutRequestID,

            paymentData

        );


        /* =========================================
           RESPOND TO SAFARICOM
        ========================================= */

        return res.status(200).json({

            ResultCode: 0,

            ResultDesc:
                "Callback received successfully"

        });

    }


    catch (error) {

        console.error(
            "CALLBACK ERROR:",
            error.response?.data || error.message
        );


        /*
        Always acknowledge the callback so that
        Safaricom does not keep retrying because
        of a server response error.
        */

        return res.status(200).json({

            ResultCode: 0,

            ResultDesc:
                "Accepted"

        });

    }

};
