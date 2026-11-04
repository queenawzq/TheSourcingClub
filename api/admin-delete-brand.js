import { deleteCompany } from "./admin-delete-factory.js";

export default function handler(request, response) {
  return deleteCompany(request, response, "brand");
}
