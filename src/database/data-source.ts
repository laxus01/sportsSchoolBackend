import 'reflect-metadata';
import 'dotenv/config';
import { DataSource } from 'typeorm';
import { createMysqlOptions } from './typeorm-options';

export default new DataSource(createMysqlOptions());
