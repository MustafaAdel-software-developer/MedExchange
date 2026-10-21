//inserts one service and reads it back.

import { pool } from "../src/db/pool.js";
import { findService, insertService, serviceDto } from "../src/services/db.js";

try{
    const mockService: serviceDto = {
  practice_id: "7d2e4f6a-8b0c-4d2e-9f1a-3b5c7d9e1f0a",
    title: "Standard Diagnostic Assessment",
    price_cents: 9500,
};

const service_id = await insertService(mockService);
const service = await findService(service_id);
if(!service){
    console.log('not found');
    
}else{
    console.log(service)
}
}finally{
  await pool.end();
}