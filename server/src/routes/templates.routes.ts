import { Router } from 'express';
import { PrismaClient } from '@prisma/client';
import { EmailTemplateSchema } from '../models/validation.js';
import { NormalizerService } from '../services/normalizer.service.js';

export function createTemplatesRouter(prisma: PrismaClient): Router {
  const router = Router();

  /**
   * List all templates
   */
  router.get('/', async (_req, res, next) => {
    try {
      const templates = await prisma.emailTemplate.findMany({
        orderBy: [{ isDefault: 'desc' }, { updatedAt: 'desc' }],
      });
      res.json(templates);
    } catch (err) {
      next(err);
    }
  });

  /**
   * Create template
   */
  router.post('/', async (req, res, next) => {
    try {
      const data = EmailTemplateSchema.parse(req.body);

      if (data.isDefault) {
        await prisma.emailTemplate.updateMany({
          data: { isDefault: false },
        });
      }

      const template = await prisma.emailTemplate.create({
        data,
      });

      res.status(201).json(template);
    } catch (err) {
      next(err);
    }
  });

  /**
   * Update template
   */
  router.put('/:id', async (req, res, next) => {
    try {
      const data = EmailTemplateSchema.parse(req.body);

      if (data.isDefault) {
        await prisma.emailTemplate.updateMany({
          where: { id: { not: req.params.id } },
          data: { isDefault: false },
        });
      }

      const template = await prisma.emailTemplate.update({
        where: { id: req.params.id },
        data,
      });

      res.json(template);
    } catch (err) {
      next(err);
    }
  });

  /**
   * Delete template
   */
  router.delete('/:id', async (req, res, next) => {
    try {
      await prisma.emailTemplate.delete({
        where: { id: req.params.id },
      });
      res.json({ success: true });
    } catch (err) {
      next(err);
    }
  });

  /**
   * Live preview render
   */
  router.post('/preview', async (req, res, next) => {
    try {
      const { subject, bodyText, contactId, sampleVariables } = req.body;

      let variables = sampleVariables || {
        FirstName: 'Alex',
        LastName: 'Johnson',
        FullName: 'Alex Johnson',
        Company: 'Stripe',
        JobTitle: 'Technical Recruiter',
        Role: 'Software Engineer',
        JobURL: 'https://stripe.com/jobs/1234',
        Email: 'alex.j@stripe.com',
      };

      if (contactId) {
        const contact = await prisma.contact.findUnique({
          where: { id: contactId },
        });

        if (contact) {
          variables = {
            FirstName: contact.firstName || '',
            LastName: contact.lastName || '',
            FullName: contact.fullName,
            Company: contact.companyName,
            JobTitle: contact.jobTitle || '',
            Role: contact.matchedRole || 'Opportunities',
            JobURL: '',
            Email: contact.email,
          };
        }
      }

      const rendered = NormalizerService.renderTemplate(subject || '', bodyText || '', variables);
      res.json({
        rendered,
        availableVariables: [
          '{{FirstName}}',
          '{{LastName}}',
          '{{FullName}}',
          '{{Company}}',
          '{{JobTitle}}',
          '{{Role}}',
          '{{JobURL}}',
          '{{Email}}',
        ],
      });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
