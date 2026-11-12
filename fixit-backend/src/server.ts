import {app} from "./app.js";
import { env } from "./config/env.js"; // CHANGE 1: validated config

const PORT = env.PORT // CHANGE 2: was 3000

app.listen(PORT,(error?:Error)=>{
      if(error){
        console.error("Error starting server:", error);
        process.exit(1);
      }else{
        console.log(`FIXITAPi is running on port ${PORT}`);
      }
})