//inserts one service and reads it back.

import { pool } from "../src/db/pool.js";
import { findService, insertService } from "../src/services/db.js";
import { CreateService } from "../src/services/schema.js";

try{
    const mockService: CreateService = {
    title: "Standard Diagnostic Assessment",
    priceCents: 9500,
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