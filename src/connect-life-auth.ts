// These application identifiers describe the official ConnectLife client.
// They are not user credentials, but keeping them together makes protocol
// updates easier if ConnectLife changes its authentication flow.
export const CONNECT_LIFE_AUTH = {
    gigyaApiKey: '4_yhTWQmHFpZkQZDSV1uV-_A',
    gigyaClientSecret:
        '07swfKgvJhC3ydOUS9YV_SwVz0i4LKqlOLGNUukYHVMsJRF1b-iWeUGcNlXyYCeK',
    clientId: '5065059336212',
    gmid:
        'gmid.ver4.AtLt3mZAMA.C8m5VqSTEQDrTRrkYYDgOaJWcyQ-XHow5nzQSXJF3EO3TnqTJ8tKUmQaaQ6z8p0s.zcTbHe6Ax6lHfvTN7JUj7VgO4x8Vl-vk1u0kZcrkKmKWw8K9r0shyut_at5Q0ri6zTewnAv2g1Dc8dauuyd-Sw.sc3',
    redirectUri: 'https://api.connectlife.io/swagger/oauth2-redirect.html',
    gigyaLoginUrl: 'https://accounts.eu1.gigya.com/accounts.login',
    gigyaJwtUrl: 'https://accounts.eu1.gigya.com/accounts.getJWT',
    authorizeUrl: 'https://oauth.hijuconn.com/oauth/authorize',
    tokenUrl: 'https://oauth.hijuconn.com/oauth/token',
} as const;
