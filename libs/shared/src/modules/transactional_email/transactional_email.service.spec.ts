import { ConfigService } from '@nestjs/config';
import { MailerService } from '@nestjs-modules/mailer';

import { TransactionalEmailService } from './transactional_email.service';

describe('TransactionalEmailService', () => {
  let service: TransactionalEmailService;
  let configValues: Record<string, string | undefined>;
  let configService: ConfigService;
  let mailerService: MailerService;
  let sendMail: jest.Mock;
  let fetchMock: jest.Mock;

  beforeEach(() => {
    configValues = {};
    sendMail = jest.fn().mockResolvedValue(undefined);
    fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      text: jest.fn().mockResolvedValue(''),
    });

    configService = {
      get: jest.fn((key: string) => configValues[key]),
    } as unknown as ConfigService;

    mailerService = {
      sendMail,
    } as unknown as MailerService;

    global.fetch = fetchMock as unknown as typeof fetch;

    service = new TransactionalEmailService(mailerService, configService);
  });

  afterEach(() => {
    Reflect.deleteProperty(global, 'fetch');
    jest.resetAllMocks();
  });

  it('uses SMTP mailer when SMTP is configured', async () => {
    configValues.SMTP_HOST = 'smtp.example.com';

    await service.sendTemplateEmail({
      to: 'test@example.com',
      subject: 'Verification',
      template: 'pin-code-verification',
      context: {
        pinCode: '123456',
        expirationMinutes: 10,
        apiUrl: 'http://localhost:5050',
      },
    });

    expect(sendMail).toHaveBeenCalledWith({
      to: 'test@example.com',
      subject: 'Verification',
      template: 'pin-code-verification',
      context: {
        pinCode: '123456',
        expirationMinutes: 10,
        apiUrl: 'http://localhost:5050',
      },
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('uses Resend HTTP API when SMTP is unset and RESEND_API_KEY is configured', async () => {
    configValues.RESEND_API_KEY = 'resend-key';
    configValues.RESEND_FROM = 'noreply@example.com';
    configValues.SMTP_BCC = 'audit@example.com,ops@example.com';

    await service.sendTemplateEmail({
      to: ['test@example.com', 'admin@example.com'],
      subject: 'Verification',
      template: 'pin-code-verification',
      context: {
        pinCode: '654321',
        expirationMinutes: 10,
        apiUrl: 'http://localhost:5050',
      },
    });

    expect(sendMail).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.resend.com/emails',
      expect.objectContaining({
        method: 'POST',
        headers: {
          Authorization: 'Bearer resend-key',
          'Content-Type': 'application/json',
        },
      }),
    );

    const [, requestOptions] = fetchMock.mock.calls[0];
    const payload = JSON.parse(requestOptions.body);

    expect(payload).toMatchObject({
      from: 'noreply@example.com',
      to: ['test@example.com', 'admin@example.com'],
      bcc: ['audit@example.com', 'ops@example.com'],
      subject: 'Verification',
    });
    expect(payload.html).toContain('654321');
    expect(payload.html).toContain('10 minutes');
  });

  it('throws 503 in production when neither SMTP nor Resend is configured', async () => {
    configValues.NODE_ENV = 'production';

    await expect(
      service.sendTemplateEmail({
        to: 'test@example.com',
        subject: 'Verification',
        template: 'pin-code-verification',
        context: {
          pinCode: '123456',
          expirationMinutes: 10,
          apiUrl: 'http://localhost:5050',
        },
      }),
    ).rejects.toMatchObject({
      status: 503,
      message:
        'Email delivery is not configured. Please contact an administrator.',
    });

    expect(sendMail).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('falls back to local stream transport outside production when email is not configured', async () => {
    await service.sendTemplateEmail({
      to: 'test@example.com',
      subject: 'Verification',
      template: 'pin-code-verification',
      context: {
        pinCode: '123456',
        expirationMinutes: 10,
        apiUrl: 'http://localhost:5050',
      },
    });

    expect(sendMail).toHaveBeenCalledWith({
      to: 'test@example.com',
      subject: 'Verification',
      template: 'pin-code-verification',
      context: {
        pinCode: '123456',
        expirationMinutes: 10,
        apiUrl: 'http://localhost:5050',
      },
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
