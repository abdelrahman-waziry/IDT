const auth = require('./engine/authenticity-service.js');
auth.checkAuthenticity('00008110-001938AA0120A01E').then(res => console.log(JSON.stringify(res, null, 2)));
