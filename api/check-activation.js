const axios = require("axios");

/* =========================================
   REDIS CONFIGURATION
========================================= */

const REDIS_URL =
    process.env.UPSTASH_REDIS_REST_URL;

const REDIS_TOKEN =
    process.env.UPSTASH_REDIS_REST_TOKEN;


/* =========================================
   GET PAYMENT DATA
========================================= */

async function getPayment(checkoutRequestID) {

    if (!REDIS_URL || !REDIS_TOKEN) {

        throw new Error(
            "Payment database configuration is missing."
        );

    }


    const response = await axios.get(

        `${REDIS_URL}/get/activation:${checkoutRequestID}`,

        {

            headers: {

                Authorization:
                    `Bearer ${REDIS_TOKEN}`

            }

        }

    );


    return response.data.result;

}


/* =========================================
   CHECK ACTIVATION STATUS
========================================= */

module.exports = async (req, res) => {

    if (req.method !== "POST") {

        return res.status(405).json({

            activated: false,

            message:
                "Method not allowed."

        });

    }


    try {

        const checkoutRequestID =
            req.body.checkoutRequestID;


        if (!checkoutRequestID) {

            return res.status(400).json({

                activated: false,

                status:
                    "NO_PAYMENT",

                message:
                    "Payment request not found."

            });

        }


        const storedPayment =
            await getPayment(
                checkoutRequestID
            );


        /* PAYMENT CALLBACK NOT RECEIVED YET */

        if (!storedPayment) {

            return res.status(200).json({

                activated: false,

                status:
                    "PENDING",

                message:
                    "Waiting for payment confirmation."

            });

        }


        /*
        Upstash may return the stored JSON as
        either an object or a string.
        */

        let paymentData =
            storedPayment;


        if (
            typeof storedPayment ===
            "string"
        ) {

            paymentData =
                JSON.parse(storedPayment);

        }


        /* SUCCESS */

        if (
            paymentData.status ===
            "SUCCESS" &&

            paymentData.activated ===
            true
        ) {

            return res.status(200).json({

                activated: true,

                status:
                    "SUCCESS",

                amount:
                    paymentData.amount || 350,

                mpesaReceipt:
                    paymentData.mpesaReceipt || null,

                message:
                    "Payment confirmed. Your account is activated."

            });

        }


        /* FAILED / CANCELLED */

        if (
            paymentData.status ===
            "FAILED"
        ) {

            return res.status(200).json({

                activated: false,

                status:
                    "FAILED",

                message:

                    paymentData.resultDesc ||

                    "Payment was cancelled or failed."

            });

        }


        /* STILL PENDING */

        return res.status(200).json({

            activated: false,

            status:
                "PENDING",

            message:
                "Waiting for payment confirmation."

        });

    }


    catch (error) {

        console.error(

            "CHECK ACTIVATION ERROR:",

            error.response?.data ||
            error.message

        );


        return res.status(500).json({

            activated: false,

            status:
                "ERROR",

            message:
                "Unable to check payment status."

        });

    }

};
