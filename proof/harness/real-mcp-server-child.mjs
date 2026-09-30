import { createCrossingKeyApp } from '../../server.mjs';
const app=createCrossingKeyApp();
const server=app.listen(0,'127.0.0.1',()=>process.send?.({ready:true,pid:process.pid,port:server.address().port}));
process.on('SIGTERM',()=>server.close(()=>process.exit(0)));
