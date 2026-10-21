import { UUID } from "node:crypto";
import { pool } from "../db/pool.js";


export type serviceDto = {
  practice_id?: UUID;
  title: string;
  price_cents: number;
};

export type Service = {
  id: UUID;
  practice_id?: UUID;
  title: string;
  price_cents: number;
  version: number;
  created_at: Date;
  updated_at: Date;
};

export async function insertService(service: serviceDto) {
  try {
    const service_id = await pool.query(
      "INSERT INTO services (practice_id,title,price_cents) VALUES ($1, $2, $3) RETURNING id;",
      [service.practice_id, service.title, service.price_cents],
    );
    console.log("service inserted");
    return service_id.rows[0].id;
  } catch (err) {
    throw err;
  }
}

export async function findService(id: UUID) : Promise<Service | null >{
  try {
    const res = await pool.query("SELECT * FROM services WHERE id = $1", [id]);
    if(res.rows[0] === undefined){
        return null;
    }
    const service = {
      ...res.rows[0],
      price_cents: Number(res.rows[0].price_cents),
    };

    return service;
  } catch (err) {
    
    throw err;
  }
}

async function listServices() {
  try {
    const sql = "SELECT * FROM services";
    const res = await pool.query(sql);
    const service = res.rows;
    return service;
  } catch (err) {
    throw err;
  }
}

async function updateService(id: UUID, service: serviceDto) {
  try {
    const sql =
      "UPDATE services SET practice_id = $2, title = $3, price_cents = $4, version = $5, updated_at = now() WHERE id = $1";
    const old_service_data = await pool.query(
      "SELECT * FROM services WHERE id = $1",
      [id],
    );
    await pool.query(sql, [
      id,
      service.practice_id ?? old_service_data.rows[0].practice_id,
      service.title ?? old_service_data.rows[0].title,
      service.price_cents ?? old_service_data.rows[0].price_cents,
      old_service_data.rows[0].version + 1,
    ]);
    console.log("service updated");
  } catch (err) {
    throw err;
  }
}
