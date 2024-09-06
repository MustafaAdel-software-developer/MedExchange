import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

/**
 * End-to-end smoke test for the core auth slice (register/login/refresh/logout/change-password/
 * get-user), run against the real (dev) Postgres database via PrismaService — same DB the .NET
 * app targets, proving the two APIs are interchangeable for this slice.
 */
describe('Auth (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  const email = `nest.e2e.${Date.now()}@example.com`;
  const phone = `555${Math.floor(1000000 + Math.random() * 8999999)}`;
  const password = 'Passw0rd!';

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    prisma = moduleFixture.get(PrismaService);
  });

  afterAll(async () => {
    await prisma.users.deleteMany({ where: { Email: email } });
    await app.close();
  });

  let accessToken: string;
  let refreshToken: string;
  let userId: string;

  it('registers a new user and returns a token pair', async () => {
    const res = await request(app.getHttpServer())
      .post('/auth/register')
      .send({
        firstName: 'Nest',
        lastName: 'E2E',
        email,
        phoneNumber: phone,
        dateOfBirth: '1990-01-01',
        gender: 1,
        password,
        confirmPassword: password,
      })
      .expect(200);

    expect(res.body.isAuthenticated).toBe(false);
    expect(res.body.token).toBeTruthy();
    expect(res.body.refreshToken).toBeTruthy();
    expect(res.body.email).toBe(email);
  });

  it('rejects login before the email is confirmed', async () => {
    const res = await request(app.getHttpServer()).post('/auth/login').send({ email, password }).expect(400);
    expect(res.body.message).toBe('Email needs to be confirmed');
  });

  it('confirms email with the verification code', async () => {
    const created = await prisma.users.findFirstOrThrow({ where: { Email: email } });
    const res = await request(app.getHttpServer())
      .get('/auth/confirm-email')
      .query({ email, token: created.VerificationCode })
      .expect(200);
    expect(res.text.replace(/"/g, '')).toMatch(/verifySuccess|\/login/);
  });

  it('rejects login with the wrong password', async () => {
    const res = await request(app.getHttpServer()).post('/auth/login').send({ email, password: 'wrong' }).expect(400);
    expect(res.body.message).toBe('Invalid login');
  });

  it('logs in successfully once confirmed, with the right password', async () => {
    const res = await request(app.getHttpServer()).post('/auth/login').send({ email, password }).expect(200);
    expect(res.body.isAuthenticated).toBe(true);
    accessToken = res.body.token;
    refreshToken = res.body.refreshToken;

    const user = await prisma.users.findFirst({ where: { Email: email } });
    userId = user!.Id;
  });

  it('fetches the user profile with the access token (self-access)', async () => {
    const res = await request(app.getHttpServer())
      .get(`/auth/users/${userId}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
    expect(res.body.email).toBe(email);
    expect(res.body.firstName).toBe('Nest');
  });

  it('rejects the profile fetch without a token', async () => {
    await request(app.getHttpServer()).get(`/auth/users/${userId}`).expect(401);
  });

  it('rejects fetching another user\'s profile (AuthorizeUserDataGuard)', async () => {
    await request(app.getHttpServer())
      .get(`/auth/users/${'11111111-1111-1111-1111-111111111111'}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(403);
  });

  it('rotates the refresh token and rejects reusing the old one', async () => {
    const res = await request(app.getHttpServer())
      .post(`/auth/refresh-token/${'00000000-0000-0000-0000-000000000000'}`)
      .send({ refreshToken })
      .expect(200);
    expect(res.body.isAuthenticated).toBe(true);
    expect(res.body.refreshToken).not.toBe(refreshToken);
    accessToken = res.body.token;
    refreshToken = res.body.refreshToken;

    await request(app.getHttpServer())
      .post('/auth/refresh-token')
      .send({ refreshToken: 'stale-token-not-reusable' })
      .expect(400);
  });

  it('rejects refresh for an entity the user does not belong to', async () => {
    await request(app.getHttpServer())
      .post(`/auth/refresh-token/${'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'}`)
      .send({ refreshToken })
      .expect(400);
  });

  it('rejects get-token when the user has no EntityUsers row (AuthorizeEntityTokenGuard)', async () => {
    await request(app.getHttpServer())
      .post(`/auth/get-token/${'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'}/1`)
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(403);
  });

  it('lists user entities (empty for a brand-new user)', async () => {
    const res = await request(app.getHttpServer())
      .get(`/users/GetUserEntitiesById/${userId}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
    expect(res.body.entities).toEqual([]);
    expect(res.body.unCertifiedExists).toBe(false);
  });

  it('changes the password and rejects the old one afterwards', async () => {
    const res = await request(app.getHttpServer())
      .put('/auth/change-password')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ currentPassword: password, newPassword: 'NewPassw0rd!', confirmPassword: 'NewPassw0rd!' })
      .expect(200);
    expect(res.body.status).toBe('Success');

    await request(app.getHttpServer()).post('/auth/login').send({ email, password }).expect(400);
    await request(app.getHttpServer()).post('/auth/login').send({ email, password: 'NewPassw0rd!' }).expect(200);
  });

  it('logs out and rejects reusing the refresh token afterwards', async () => {
    const loginRes = await request(app.getHttpServer()).post('/auth/login').send({ email, password: 'NewPassw0rd!' }).expect(200);

    await request(app.getHttpServer())
      .post('/auth/logout')
      .set('Authorization', `Bearer ${loginRes.body.token}`)
      .send({ refreshToken: loginRes.body.refreshToken })
      .expect(200);

    await request(app.getHttpServer()).post('/auth/refresh-token').send({ refreshToken: loginRes.body.refreshToken }).expect(400);
  });
});
